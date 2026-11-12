"""What Claude can read when it digs: app-made views of the ledger, and nothing else.

Claude writes SQL and the app runs it here. The SQL never touches the real database: each question
gets a private in-memory copy holding only the tables below, filled by the same code the Month page
uses, so chat messages, proposals and settings are simply not there to reach. On top of that the
connection is read-only, an authorizer allows nothing but reading these tables, and each query has a
row cap and a time limit.
"""
import math
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from statistics import median_low

import clock
import money
import set_asides
import spend_service
from aggregate import is_spend_part, spend_contribution
import db as database
from db import SessionLocal
from financial_month import get_financial_month_range, label_month_for_date
from models import Budget, Category, Rule, Transaction, TransactionSource
from routers import budget as budget_router
from routers import dashboard as dashboard_router
from routers import goals as goals_router
from routers.recurring import _key as merchant_key
from sqlalchemy.orm import Session, selectinload

ROW_CAP = 200
QUERY_SECONDS = 2
MAX_TEXT = 140
MAX_VALUE_LENGTH = 20_000
QUIET_DAYS = 3  # a bank's rows this far from a month's edge mean its files start late or stop early
HOLE_DAYS = 14  # this long without a row inside a month means part of a bank's file is missing
MIN_DATES_FOR_RHYTHM = 4  # a bank seen on fewer days than this can't be said to be missing from a month
_BANK_SOURCES = (TransactionSource.ing,)

# What Claude is told it can read. Every column of the DDL below is described here.
SCHEMA = """spending: one row per effective part of a confirmed transaction, exactly as the Month page counts them (a split gives one row per part; a bill paid from a set-aside is here only for the part that had not been set aside yet). Columns: month ('YYYY-MM', the financial month), date, transaction_id, description, merchant (lower-case words that group one shop's rows), source, category, category_type (needs, wants, savings, income, exclude), amount_cents (signed, as at the bank), spend_cents (what it adds to spending: positive for an expense, negative for a refund, 0 otherwise), counts_as (spend, refund, income, excluded, uncategorised, other), is_split.
category_months: one row per expense category per financial month that has any rows, zero included, equal to the Month page. Columns: month, category, category_type (needs, wants, savings), spent_cents (refunds already netted; can be negative).
month_totals: one row per financial month that has any rows. Columns: month, income_cents, expenses_cents, needs_cents, wants_cents, savings_cents, left_over_cents.
coverage: one row per financial month from the first imported month to now. Columns: month, start_date, end_date, bank_rows, first_bank_date, last_bank_date, to_review (payments waiting for an answer, not counted in the views above), status (complete, in progress, partial, no data), detail (which bank's rows are missing, when partial).
transactions: the raw rows, not resolved: a split shows as one row and refunds are not netted, so totals from here will differ from the app. confirmed = 0 is a payment waiting for a person's answer (Claude was not sure of it), with its guessed category if it has one; confirmed = 1 with categorised_by 'ai' was sorted automatically because Claude was sure. set_aside_id is set when the payment settled a set-aside bill. Columns: id, date, month, amount_cents, description, merchant, source, category_id, category, category_type, is_refund, confirmed, categorised_by, has_splits, set_aside_id.
categories: every category. Columns: id, name, type (needs, wants, savings, income, exclude), position.
budgets: planned amounts. A plan stays as it is until changed: a month without rows of its own has the amounts of the newest earlier month (rows with month NULL are only the starting amounts from before any month was planned). Columns: month, category_id, category, planned_cents.
rules: what sorts imported rows automatically: a description containing pattern gets category; when several fit, the longest pattern wins. Columns: id, pattern, category_id, category.
set_asides: yearly or irregular bills spread over the months before they are due, as this month sees them. Columns: id, name, amount_cents, due_month, yearly, monthly_cents (this month's share, which lowers what is free to spend), saved_cents (set aside so far), paid_transaction_id, paid_date.
savings_goals: as the Trends page shows them. Columns: name, category_id, category, target_cents, start_cents (in the pot when it started), saved_cents, started, by_month, status (done, open, late, unknown, short, on_track), needed_per_month_cents, pace_per_month_cents, short_per_month_cents, reach_month."""

_DDL = """
CREATE TABLE spending (month TEXT, date TEXT, transaction_id INTEGER, description TEXT, merchant TEXT, source TEXT,
  category TEXT, category_type TEXT, amount_cents INTEGER, spend_cents INTEGER, counts_as TEXT, is_split INTEGER);
CREATE TABLE category_months (month TEXT, category TEXT, category_type TEXT, spent_cents INTEGER);
CREATE TABLE month_totals (month TEXT, income_cents INTEGER, expenses_cents INTEGER, needs_cents INTEGER,
  wants_cents INTEGER, savings_cents INTEGER, left_over_cents INTEGER);
CREATE TABLE coverage (month TEXT, start_date TEXT, end_date TEXT, bank_rows INTEGER, first_bank_date TEXT,
  last_bank_date TEXT, to_review INTEGER, status TEXT, detail TEXT);
CREATE TABLE transactions (id INTEGER, date TEXT, month TEXT, amount_cents INTEGER, description TEXT, merchant TEXT,
  source TEXT, category_id INTEGER, category TEXT, category_type TEXT, is_refund INTEGER, confirmed INTEGER,
  categorised_by TEXT, has_splits INTEGER, set_aside_id INTEGER);
CREATE TABLE categories (id INTEGER, name TEXT, type TEXT, position INTEGER);
CREATE TABLE budgets (month TEXT, category_id INTEGER, category TEXT, planned_cents INTEGER);
CREATE TABLE rules (id INTEGER, pattern TEXT, category_id INTEGER, category TEXT);
CREATE TABLE set_asides (id INTEGER, name TEXT, amount_cents INTEGER, due_month TEXT, yearly INTEGER,
  monthly_cents INTEGER, saved_cents INTEGER, paid_transaction_id INTEGER, paid_date TEXT);
CREATE TABLE savings_goals (name TEXT, category_id INTEGER, category TEXT, target_cents INTEGER, start_cents INTEGER,
  saved_cents INTEGER, started TEXT, by_month TEXT, status TEXT, needed_per_month_cents INTEGER,
  pace_per_month_cents INTEGER, short_per_month_cents INTEGER, reach_month TEXT);
"""
_TABLES = {
    "spending", "category_months", "month_totals", "coverage", "transactions", "categories", "budgets", "rules",
    "set_asides", "savings_goals",
}
_FUNCTIONS = {
    "abs", "avg", "coalesce", "concat", "concat_ws", "count", "cume_dist", "date", "datetime", "dense_rank",
    "first_value", "format", "glob", "group_concat", "iif", "if", "ifnull", "instr", "julianday", "lag", "last_value",
    "lead", "length", "like", "lower", "ltrim", "max", "min", "nth_value", "ntile", "nullif", "percent_rank", "printf",
    "rank", "replace", "round", "row_number", "rtrim", "sign", "string_agg", "strftime", "substr", "substring", "sum",
    "time", "timediff", "total", "trim", "typeof", "unixepoch", "upper",
}


def _authorise(action: int, first, second, _database, _trigger) -> int:
    allowed = (
        action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_RECURSIVE)
        or (action == sqlite3.SQLITE_READ and (
            first in _TABLES
            or (second == "" and not str(first).startswith(("sqlite_", "pragma_", "dbstat")))  # count(*) over a WITH
        ))
        or (action == sqlite3.SQLITE_FUNCTION and (second or "").lower() in _FUNCTIONS)
    )
    return sqlite3.SQLITE_OK if allowed else sqlite3.SQLITE_DENY


def _label(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _next_label(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _counts_as(category: Category | None, amount, refund: bool) -> str:
    if category is None:
        return "uncategorised"
    if category.type.value == "exclude":
        return "excluded"
    if is_spend_part(amount, refund):
        return "refund" if refund else "spend"
    return "income" if amount > 0 else "other"


@dataclass
class _Month:
    year: int
    mo: int
    start: date
    end: date
    parts: list = field(default_factory=list)  # (category_id, amount, refund): the Month page's input
    bank_dates: dict = field(default_factory=dict)  # bank name -> the days it has rows
    to_review: int = 0


def _months_between(first: tuple[int, int], last: tuple[int, int], start_day: int) -> dict[str, _Month]:
    months, current = {}, first
    while current <= last:
        months[_label(*current)] = _Month(*current, *get_financial_month_range(*current, start_day))
        current = _next_label(*current)
    return months


def _rhythms(txs: list[Transaction]) -> dict[str, tuple[date, int, int]]:
    """For each bank with a history: its first day, and how far from an edge and how long a silence is odd.

    A card account has rows most days; a savings account perhaps twice a month. Each is held to its own pace.
    """
    days: dict[str, set[date]] = {}
    for tx in txs:
        if tx.source in _BANK_SOURCES:
            days.setdefault(tx.source.value, set()).add(tx.date)
    rhythms = {}
    for bank, seen in days.items():
        ordered = sorted(seen)
        if len(ordered) < MIN_DATES_FOR_RHYTHM:
            continue
        typical = median_low([(b - a).days for a, b in zip(ordered, ordered[1:])])
        if typical <= 31:
            rhythms[bank] = (ordered[0], max(QUIET_DAYS, 2 * typical), max(HOLE_DAYS, 3 * typical))
    return rhythms


def _missing(month: _Month, today: date, rhythms: dict) -> list[str]:
    """Which bank's rows are missing from this month, in plain phrases."""
    reach = min(month.end, today)
    phrases = []
    for bank, (first_seen, edge, hole) in rhythms.items():
        if first_seen > reach or month.start > today:
            continue
        name = bank.upper()
        days = sorted(set(month.bank_dates.get(bank, [])))
        if not days:
            phrases.append(f"no {name} rows")
            continue
        if (days[0] - month.start).days > edge or (reach - days[-1]).days > edge:
            phrases.append(f"{name} rows only run from {days[0]} to {days[-1]}")
        for before, after in zip(days, days[1:]):
            if (after - before).days > hole:
                phrases.append(f"{name} has no rows between {before} and {after}")
    return phrases


def _status(month: _Month, today: date, missing: list[str]) -> str:
    if not month.bank_dates:
        return "no data"
    if missing:
        return "partial"
    return "complete" if month.end < today else "in progress"


def _fill_setup(conn: sqlite3.Connection, db) -> None:
    """The household's set-up: categories, plans, rules, set-asides and savings goals."""
    names = {c.id: c.name for c in db.query(Category).all()}
    conn.executemany("INSERT INTO categories VALUES (?,?,?,?)", [
        (c.id, c.name, c.type.value, c.sort_order) for c in db.query(Category).order_by(Category.sort_order).all()
    ])
    conn.executemany("INSERT INTO budgets VALUES (?,?,?,?)", [
        (b.month.strftime("%Y-%m") if b.month else None, b.category_id, names.get(b.category_id), money.to_cents(b.planned_amount))
        for b in db.query(Budget).all()
    ])
    conn.executemany("INSERT INTO rules VALUES (?,?,?,?)", [
        (r.id, r.pattern, r.category_id, names.get(r.category_id)) for r in db.query(Rule).all()
    ])
    conn.executemany("INSERT INTO set_asides VALUES (?,?,?,?,?,?,?,?,?)", [
        (b["id"], b["name"], b["amount_cents"], b["due_month"], b["yearly"], b["monthly_cents"], b["saved_cents"],
         (b["payment"] or {}).get("transaction_id"), (b["payment"] or {}).get("date"))
        for b in set_asides.month_view(db)["items"]
    ])
    conn.executemany("INSERT INTO savings_goals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        (g["name"], g["category_id"], g["category_name"], g["target_cents"], g["start_cents"], g["saved_cents"],
         g["started"], g["by"], g["status"], g["needed_cents"], g["pace_cents"], g["short_cents"], g["reach"])
        for g in goals_router._view(db)["goals"]
    ])


def _fill(conn: sqlite3.Connection, db) -> None:
    """Copy the ledger in, resolved the way the Month page resolves it. Writes nothing to the real database."""
    _fill_setup(conn, db)
    conn.commit()
    today = clock.today()
    start_day = spend_service.get_start_day(db)
    categories = {c.id: c for c in db.query(Category).all()}
    txs = (
        db.query(Transaction).options(selectinload(Transaction.splits))
        .order_by(Transaction.date, Transaction.id).all()
    )
    if not txs:
        return
    current = label_month_for_date(today, start_day)
    newest = label_month_for_date(txs[-1].date, start_day)
    months = _months_between(label_month_for_date(txs[0].date, start_day), max(current, newest), start_day)

    def spending_row(label, day, tx_id, description, source, category_id, amount, refund, is_split):
        category = categories.get(category_id)
        counts_as = _counts_as(category, amount, refund)
        spend = money.to_cents(spend_contribution(amount, refund)) if counts_as in ("spend", "refund") else 0
        return (
            label, day.isoformat(), tx_id, description[:MAX_TEXT], merchant_key(description), source,
            category.name if category else None, category.type.value if category else None,
            money.to_cents(amount), spend, counts_as, is_split,
        )

    spending, raw = [], []
    for tx in txs:
        label = _label(*label_month_for_date(tx.date, start_day))
        month = months[label]
        category = categories.get(tx.category_id)
        raw.append((
            tx.id, tx.date.isoformat(), label, money.to_cents(tx.amount), tx.description[:MAX_TEXT],
            merchant_key(tx.description), tx.source.value, tx.category_id, category.name if category else None,
            category.type.value if category else None, bool(tx.is_refund), bool(tx.confirmed),
            tx.categorised_by.value if tx.categorised_by else None, bool(tx.splits), tx.set_aside_id,
        ))
        if tx.source in _BANK_SOURCES:
            month.bank_dates.setdefault(tx.source.value, []).append(tx.date)
        if not tx.confirmed:
            month.to_review += 1
            continue
        # A bill paid from a set-aside is here only for the part that had not been set aside yet.
        for category_id, amount, refund in set_asides.counted_parts(tx, start_day):
            month.parts.append((category_id, amount, refund))
            spending.append(spending_row(
                label, tx.date, tx.id, tx.description, tx.source.value, category_id, amount, refund, bool(tx.splits),
            ))

    excluded = {cid for cid, c in categories.items() if c.type.value == "exclude"}
    not_expenses = excluded | {cid for cid, c in categories.items() if c.type.value == "income"}
    expenses = {cid: c for cid, c in categories.items() if cid not in not_expenses}
    by_category, totals, coverage = [], [], []
    rhythms = _rhythms(txs)
    for label, month in months.items():
        bank_days = [day for days in month.bank_dates.values() for day in days]
        missing = _missing(month, today, rhythms)
        coverage.append((
            label, month.start.isoformat(), month.end.isoformat(), len(bank_days),
            min(bank_days).isoformat() if bank_days else None,
            max(bank_days).isoformat() if bank_days else None,
            month.to_review, _status(month, today, missing), "; ".join(missing) or None,
        ))
        if not month.parts:
            continue
        spent = spend_service.spend_totals_by_category(month.parts, not_expenses)
        for cid, category in expenses.items():
            by_category.append((label, category.name, category.type.value, money.to_cents(spent.get(cid, 0))))
        all_spent = spend_service.spend_totals_by_category(month.parts, excluded)
        income = spend_service.income_totals_by_category(month.parts, excluded)
        of_kind = lambda kind: money.to_cents(sum(  # noqa: E731
            v for cid, v in all_spent.items() if categories[cid].type.value == kind
        ))
        total_spent, total_income = sum(all_spent.values()), sum(income.values())
        totals.append((
            label, money.to_cents(total_income), money.to_cents(total_spent), of_kind("needs"), of_kind("wants"),
            of_kind("savings"), money.to_cents(total_income - total_spent),
        ))

    conn.executemany("INSERT INTO spending VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", spending)
    conn.executemany("INSERT INTO category_months VALUES (?,?,?,?)", by_category)
    conn.executemany("INSERT INTO month_totals VALUES (?,?,?,?,?,?,?)", totals)
    conn.executemany("INSERT INTO coverage VALUES (?,?,?,?,?,?,?,?,?)", coverage)
    conn.executemany("INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", raw)
    conn.commit()


def _cell(value):
    if isinstance(value, bytes):
        return "(binary)"
    if isinstance(value, float):
        return round(value, 4) if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:MAX_TEXT]
    return value


class Views:
    """One question's private copy. Used by one caller at a time, from whichever thread serves its tools."""

    def __init__(self) -> None:
        self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._conn.executescript(_DDL)
        with SessionLocal() as db:
            _fill(self._conn, db)
        self._conn.execute("PRAGMA query_only = ON")
        self._conn.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        # The time limit can only act between steps, so no single step may get long: short text, short patterns.
        self._conn.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_VALUE_LENGTH)
        self._conn.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, MAX_VALUE_LENGTH)
        self._conn.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 200)
        self._coverage = [
            dict(zip(("month", "first_bank_date", "last_bank_date", "to_review", "status", "detail"), row))
            for row in self._conn.execute(
                "SELECT month, first_bank_date, last_bank_date, to_review, status, detail FROM coverage ORDER BY month"
            )
        ]
        self._conn.set_authorizer(_authorise)

    def close(self) -> None:
        self._conn.close()

    def run(self, query_id: str, sql: str) -> dict:
        """The rows, or an error Claude can read. A query never raises and never changes anything."""
        started = time.monotonic()
        self._conn.set_progress_handler(lambda: time.monotonic() - started > QUERY_SECONDS, 2000)
        try:
            cursor = self._conn.execute(sql)
            if cursor.description is None:
                return {"id": query_id, "error": "Only one SELECT can be run, nothing else."}
            rows = cursor.fetchmany(ROW_CAP + 1)
            columns = [c[0] for c in cursor.description]
        except sqlite3.OperationalError as e:
            late = "interrupted" in str(e)
            return {"id": query_id, "error": f"Stopped after {QUERY_SECONDS} seconds." if late else f"Refused: {e}."}
        except (sqlite3.Error, sqlite3.Warning, ValueError, OverflowError, MemoryError) as e:
            return {"id": query_id, "error": f"Refused: {e}"}
        finally:
            self._conn.set_progress_handler(None, 0)
        cut_off = len(rows) > ROW_CAP
        rows = rows[:ROW_CAP]
        result = {
            "id": query_id, "columns": columns, "rows": [[_cell(v) for v in row] for row in rows],
            "row_count": len(rows), "cut_off": cut_off,
        }
        if cut_off:
            result["note"] = f"Cut off: only the first {ROW_CAP} rows came back, so this is not everything."
        return result

    def coverage_note(self) -> dict:
        """What every set of results is read against: where the data starts and stops, and the holes in it."""
        if not self._coverage:
            return {"no_data": True}
        return {
            "first_month": self._coverage[0]["month"],
            "last_month": self._coverage[-1]["month"],
            "months_with_gaps": [m for m in self._coverage if m["status"] in ("no data", "partial")],
            "payments_waiting_for_an_answer_not_counted": sum(m["to_review"] for m in self._coverage),
        }


# ---- The Month page, as it shows a month ----------------------------------------------------------

@contextmanager
def _untouched():
    """A session for reading the Month page's figures. Opening a month fills in its plan, as the page
    does; here that is rolled back, so a lookup never changes anything."""
    with database.engine.connect() as conn:
        conn.exec_driver_sql("BEGIN")
        session = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        try:
            yield session
        finally:
            session.close()
            conn.rollback()


def month_overview(label: str | None = None) -> dict:
    """One financial month exactly as the Month page shows it (the current one by default)."""
    with _untouched() as db:
        pace = dashboard_router.pace(label, db)
        label = pace["month"]
        summary = dashboard_router.summary(label, db)
        rows = budget_router.get_budget(label, db)
        left = pace["spendable_plan_cents"] - pace["spendable_actual_cents"]
        out = {
            "month": label, "is_current": label == pace["current_month"], "current_month": pace["current_month"],
            "from": pace["start_date"], "to": pace["end_date"], "today": pace["today"],
            "data": {"ok": "bank files cover it", "gap": "no bank rows in this month yet", "empty": "nothing imported yet"}[pace["status"]],
            "bank_files_run_to": pace["newest_bank_date"],
            "left_in_plan_cents": left,
            "spendable_plan_cents": pace["spendable_plan_cents"],
            "spendable_spent_cents": pace["spendable_actual_cents"],
            "planned_cents": pace["plan_cents"], "spent_cents": pace["actual_cents"],
            "income_cents": summary["total_income_cents"],
            "expenses_cents": summary["total_expenses_cents"],
            "income_minus_spending_cents": summary["left_over_cents"],
            "payments_waiting_for_an_answer_not_counted": pace["to_review"],
            "of_those_in_this_month": pace["to_review_in_month"],
            "categories": [
                {"category_id": r["category_id"], "category": r["category_name"], "type": r["category_type"],
                 "spent_cents": r["actual_amount_cents"], "planned_cents": r["planned_amount_cents"]}
                for r in rows
            ],
        }
        if out["is_current"]:
            out.update(day_number=pace["day_number"], days_left_after_today=pace["days_left"],
                       vs_plan_by_now_cents=pace["pace_delta_cents"])
            free = pace["free"]
            if free is not None:
                # The Month page's headline: what is left in the plan, less fixed bills still to come and set-asides.
                out.update(
                    free_to_spend_cents=free["free_cents"], free_per_day_cents=free["per_day_cents"],
                    fixed_bills_still_to_come_cents=free["bills_cents"], upcoming_bills=free["bills"],
                    set_aside_this_month_cents=free["set_aside_cents"], set_asides=free["set_asides"],
                )
        return out
