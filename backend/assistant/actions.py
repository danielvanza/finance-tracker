"""Every change the chat can make, and how a change is previewed and applied.

An action runs the same router code as the app. A preview runs it inside a database transaction,
compares the tables before and after, and rolls back, so the card shows what would really happen.
Applying runs it again and commits only if the outcome still matches what the person saw.
"""
import enum
import json
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Date, DateTime, Float, Numeric, select, text as sql
from sqlalchemy.orm import Session

import clock
import db as database
import guesses
import money
import reminders
import runtime_settings
import spend_service
from financial_month import label_month_for_date
from models import (
    AppliedChange, AskShop, Budget, Category, CategoryType, IgnoredBill, Reminder, RemovedBankRow, Rule, SetAside,
    Setting, Transaction, TransactionSplit,
)
from routers import budget as budget_router
from routers import categories as categories_router
from routers import goals as goals_router
from routers import recurring as recurring_router
from routers import rules as rules_router
from routers import set_asides as set_asides_router
from routers import settings as settings_router
from routers import transactions as transactions_router
from schemas import BudgetPatch, CategoryCreate, CategoryReorder, RuleCreate, RuleUpdate, SettingPatch, TransactionCreate

_NOTHING = "—"
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_LONG_MONTHS = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
]
_TYPES_WITH_BUDGET = ("needs", "wants", "savings")
MAX_BATCH = 500
_TABLES = (
    Transaction, TransactionSplit, Category, Rule, AskShop, Budget, SetAside, IgnoredBill, Setting, RemovedBankRow,
    Reminder,
)
_SETTING_NAMES = {
    "financial_month_start_day": "Financial month start day",
    "target_split": "Target split (needs/wants/savings)",
    "own_names": "The household's own names on bank transfers",
    "nudges": "Messages the bot sends unasked",
    "quiet_hours": "Quiet hours",
    "sort_model": "Model that sorts imports",
}


class ActionError(Exception):
    """The app would not accept this change. The message is safe to show."""


class StaleProposal(Exception):
    """The data moved on since the person saw the card. Carries the fresh preview."""

    def __init__(self, preview: dict):
        super().__init__("changed since shown")
        self.preview = preview


def eur(cents: int, signed: bool = False) -> str:
    sign = "-" if cents < 0 else ("+" if signed and cents > 0 else "")
    whole, rem = divmod(abs(cents), 100)
    return f"{sign}€{whole:,}".replace(",", ".") + f",{rem:02d}"


def _short_date(d: date) -> str:
    return f"{d.day} {_MONTHS[d.month - 1]}"


def describe_transaction(tx: Transaction) -> dict:
    return {
        "id": tx.id,
        "date": tx.date.isoformat(),
        "date_label": _short_date(tx.date),
        "amount_cents": money.to_cents(tx.amount),
        "amount_label": eur(money.to_cents(tx.amount), signed=True),
        "description": tx.description,
        "category": tx.category.name if tx.category else None,
    }


# ---- The operations -----------------------------------------------------------------------------

def _get(db: Session, model, row_id: Any, label: str):
    row = db.get(model, row_id) if isinstance(row_id, int) and not isinstance(row_id, bool) else None
    if row is None:
        raise ActionError(f"That {label} does not exist")
    return row


def _cents(value: Any, label: str = "amount") -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ActionError(f"The {label} is not a whole number of cents")
    return value


def _date(value: Any) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ActionError("The date is not valid") from None


def _month(value: Any) -> tuple[int, int]:
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except (TypeError, ValueError):
        raise ActionError("The month is not valid") from None
    return parsed.year, parsed.month


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ActionError(f"The {label} is missing")
    return value.strip()


def _add_transaction(db: Session, a: dict):
    transactions_router.create_transaction(TransactionCreate(
        date=_date(a.get("date")), amount_cents=_cents(a.get("amount_cents")),
        description=_text(a.get("description"), "description"), category_id=a.get("category_id"),
        is_refund=a.get("is_refund", False),
    ), db)


def _update_transaction(db: Session, a: dict):
    tx = _get(db, Transaction, a.get("id"), "transaction")
    bank_detail = {k: a[k] for k in ("date", "amount_cents", "description") if k in a}
    if bank_detail:
        is_manual = (tx.source.value if hasattr(tx.source, "value") else tx.source) == "manual"
        if not is_manual:
            raise ActionError("Only a manually added entry can have its date, amount or description changed")
        if tx.splits:
            raise ActionError("Remove the split before changing this entry's amount")
        if "date" in a:
            tx.date = _date(a["date"])
        if "amount_cents" in a:
            cents = _cents(a["amount_cents"])
            if cents == 0:
                raise ActionError("Amount must be non-zero")
            tx.amount = money.to_decimal(cents)
        if "description" in a:
            tx.description = _text(a["description"], "description")
    if a.get("category_id") is not None and tx.splits:
        raise ActionError("This transaction is split, so change its split parts instead")
    confirmed = a.get("confirmed")
    if a.get("category_id") is not None and confirmed is None:
        confirmed = True  # a person naming the category is a review
    transactions_router.patch_transaction(tx.id, transactions_router.TransactionPatchV2(
        category_id=a.get("category_id"), confirmed=confirmed, is_refund=a.get("is_refund"),
    ), db)


def _split_transaction(db: Session, a: dict):
    tx = _get(db, Transaction, a.get("id"), "transaction")
    parts = [
        {"category_id": p.get("category_id"), "amount_cents": _cents(p.get("amount_cents")),
         "is_refund": p.get("is_refund")}
        for p in a.get("parts", [])
    ]
    transactions_router.patch_transaction(
        tx.id, transactions_router.TransactionPatchV2(splits=parts, confirmed=True), db
    )


def _purchase_category(db: Session, a: dict) -> tuple[Transaction, int]:
    """The purchase a refund belongs to, and the category the refund must be booked in."""
    purchase = _get(db, Transaction, a.get("purchase_id"), "purchase")
    if purchase.amount >= 0:
        raise ActionError("The original purchase must be an outgoing payment")
    if purchase.splits:
        parts = {s.category_id for s in purchase.splits}
        if a.get("category_id") not in parts:
            raise ActionError("That purchase is split over several categories, so say which part was refunded")
        return purchase, a["category_id"]
    if purchase.category_id is None:
        raise ActionError("That purchase has no category yet, so the refund has nowhere to go")
    return purchase, purchase.category_id


def _book_refund(db: Session, a: dict):
    refund = _get(db, Transaction, a.get("refund_id"), "incoming payment")
    if refund.splits:
        raise ActionError("That incoming payment is split, so change its split parts instead")
    _, category_id = _purchase_category(db, a)
    transactions_router.patch_transaction(refund.id, transactions_router.TransactionPatchV2(
        category_id=category_id, is_refund=True, confirmed=True,
    ), db)


def _add_refund(db: Session, a: dict):
    category_id = _purchase_category(db, a)[1] if a.get("purchase_id") is not None else a.get("category_id")
    transactions_router.create_transaction(TransactionCreate(
        date=_date(a.get("date")), amount_cents=_cents(a.get("amount_cents")),
        description=_text(a.get("description"), "description"), category_id=category_id, is_refund=True,
    ), db)


def _confirm_guesses(db: Session, a: dict):
    ids = a.get("ids") or []
    if not ids:
        raise ActionError("There are no guesses to confirm")
    if len(set(ids)) != len(ids):
        raise ActionError("The same row is listed twice")
    rows = []
    for tx_id in ids:
        tx = _get(db, Transaction, tx_id, f"transaction (id {tx_id})")
        if tx.confirmed or not (tx.category_id or tx.splits):
            raise ActionError(f"Row {tx.id} ('{tx.description}') is not a guess waiting for review")
        rows.append(tx)
    for tx in rows:
        tx.confirmed = True
        tx.categorised_by = "manual"
    db.flush()
    for tx in rows:  # each confirmed shop's other waiting payments follow
        guesses.settle_like(db, tx)
    db.commit()


def _merge(db: Session, a: dict):
    manual = _get(db, Transaction, a.get("manual_id"), "manual entry")
    bank = _get(db, Transaction, a.get("bank_id"), "bank row")
    if (manual.source.value if hasattr(manual.source, "value") else manual.source) != "manual":
        raise ActionError("Only a manually added entry can be merged away")
    if manual.amount != bank.amount:
        raise ActionError("These two rows no longer have the same amount")
    bank.splits = [
        TransactionSplit(category_id=s.category_id, amount=s.amount, is_refund=s.is_refund)
        for s in manual.splits
    ]
    bank.category_id = None if manual.splits else manual.category_id
    bank.is_refund = manual.is_refund
    bank.confirmed = True
    bank.categorised_by = "manual"
    bank.ai_confidence = None
    db.delete(manual)
    db.commit()


def _set_budget(db: Session, a: dict):
    cents = _cents(a.get("planned_amount_cents"), "planned amount")
    body = BudgetPatch(planned_amount_cents=cents)
    year, mo = _budget_month(db, a)
    row = db.query(Budget).filter_by(category_id=a.get("category_id"), month=date(year, mo, 1)).first()
    if row is None:
        raise ActionError("That category has no budget for that month")
    budget_router.patch_budget(row.id, body, db)


def _budget_month(db: Session, a: dict) -> tuple[int, int]:
    """The month a plan change starts in: the one named, or the current financial month."""
    if a.get("month") is not None:
        return _month(a["month"])
    return label_month_for_date(clock.today(), spend_service.get_start_day(db))


def _prepare_budget(db: Session, a: dict):
    year, mo = _budget_month(db, a)
    budget_router._auto_populate(date(year, mo, 1), db)


def _required_month(a: dict, key: str) -> tuple[int, int]:
    if a.get(key) is None:
        raise ActionError(f"The {key} is missing")
    try:
        return _month(a[key])
    except ActionError:
        raise ActionError(f"The {key} is not valid, it needs the form YYYY-MM") from None


def _copy_budget(db: Session, a: dict):
    from_year, from_mo = _required_month(a, "from_month")
    year, mo = _budget_month(db, {"month": a.get("to_month")})
    if (from_year, from_mo) == (year, mo):
        raise ActionError("The month to copy from and the month to copy to are the same")
    copied = budget_router.planned_for(db, date(from_year, from_mo, 1))
    for row in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all():
        if row.category_id in copied and row.planned_amount != copied[row.category_id]:
            budget_router.patch_budget(
                row.id, BudgetPatch(planned_amount_cents=money.to_cents(copied[row.category_id])), db)


def _prepare_copy(db: Session, a: dict):
    _required_month(a, "from_month")
    _prepare_budget(db, {"month": a.get("to_month")})


def _whole_euros(cents: int) -> int:
    """Cents rounded to whole euros, half up, in cents."""
    return int((Decimal(cents) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) * 100


def _adjusted_categories(db: Session, a: dict) -> list[Category]:
    ids, kind = a.get("category_ids"), a.get("type")
    if (ids is None) == (kind is None):
        raise ActionError("Give either category_ids or type, not both and not neither")
    if kind is not None:
        if kind not in _TYPES_WITH_BUDGET:
            raise ActionError("The type has to be needs, wants or savings")
        found = db.query(Category).filter(Category.type == CategoryType(kind)).order_by(Category.sort_order).all()
        if not found:
            raise ActionError(f"There are no {kind} categories")
        return found
    if not isinstance(ids, list) or not ids:
        raise ActionError("category_ids needs a list of categories")
    if len(set(map(str, ids))) != len(ids):
        raise ActionError("The same category is listed twice")
    found = [_get(db, Category, i, f"category (id {i})") for i in ids]
    for c in found:
        if c.type.value not in _TYPES_WITH_BUDGET:
            raise ActionError(f"{c.name} has no plan, as it is not a need, want or saving")
    return found


def _adjust_budget(db: Session, a: dict):
    pct, by = a.get("by_pct"), a.get("by_cents")
    if (pct is None) == (by is None):
        raise ActionError("Give either by_pct or by_cents, not both and not neither")
    if pct is not None and (not isinstance(pct, int) or isinstance(pct, bool)):
        raise ActionError("by_pct is not a whole number")
    if pct is not None and pct < -100:
        raise ActionError("A plan cannot go down by more than 100%")
    if by is not None:
        _cents(by, "by_cents amount")
    year, mo = _budget_month(db, a)
    for category in _adjusted_categories(db, a):
        row = db.query(Budget).filter_by(category_id=category.id, month=date(year, mo, 1)).first()
        if row is None:
            raise ActionError(f"{category.name} has no budget for that month")
        now = money.to_cents(row.planned_amount)
        target = now + by if by is not None else int((Decimal(now) * (100 + pct) / 100).to_integral_value(ROUND_HALF_UP))
        planned = max(0, _whole_euros(target))
        if planned != now:
            _set_budget(db, {"category_id": category.id, "month": f"{year}-{mo:02d}", "planned_amount_cents": planned})


def _prepare_adjust(db: Session, a: dict):
    _prepare_budget(db, a)


_TYPE_WORDS = {
    "needs": "a need", "wants": "a want", "savings": "savings", "income": "income", "exclude": "left out of the budget",
}


def _merge_category(db: Session, a: dict):
    """Everything of one category goes into another and the first is removed."""
    source = _get(db, Category, a.get("from_id"), "category to merge away")
    target = _get(db, Category, a.get("into_id"), "category to merge into")
    if source.id == target.id:
        raise ActionError(f"{source.name} cannot be merged into itself")
    if source.type != target.type:
        raise ActionError(
            f"{source.name} is {_TYPE_WORDS[source.type.value]} and {target.name} is {_TYPE_WORDS[target.type.value]}; "
            "change one's type first")
    goals = [_goal_in(g) for g in goals_router._stored(db)]
    goal = next((g for g in goals if g["category_id"] == source.id), None)
    if goal and any(g["category_id"] == target.id for g in goals):
        raise ActionError(
            f"Both {source.name} and {target.name} have a savings goal; remove one of them first (goal.delete)")

    # The plan first, while both categories' rows are still there to read: each month with a row for either
    # gets the two plans added, so the total stays the same.
    months = {b.month for b in db.query(Budget).filter(Budget.category_id.in_((source.id, target.id)))}
    plans = {}
    for m in months:
        carried = budget_router.planned_for(db, m) if m else {}
        plans[m] = tuple(carried.get(c.id, Decimal("0")) if m else _starting_plan(db, c) for c in (source, target))
    rows = {b.month: b for b in db.query(Budget).filter_by(category_id=target.id)}
    for month, (added, kept) in plans.items():
        if added == 0:
            continue
        if month in rows:
            rows[month].planned_amount = kept + added
        else:
            db.add(Budget(category_id=target.id, month=month, planned_amount=kept + added))
    db.query(Budget).filter_by(category_id=source.id).delete()

    own = {r.pattern.lower() for r in db.query(Rule).filter_by(category_id=target.id)}
    for rule in db.query(Rule).filter_by(category_id=source.id).all():
        if rule.pattern.lower() in own:
            db.delete(rule)
        else:
            rule.category_id = target.id
            own.add(rule.pattern.lower())
    for model in (Transaction, TransactionSplit):
        db.query(model).filter_by(category_id=source.id).update({"category_id": target.id}, synchronize_session=False)
    for tx in db.query(Transaction).filter(Transaction.confirmed == False).all():  # noqa: E712
        if source.id in (tx.ai_options or []):  # what a waiting payment could be
            tx.ai_options = list(dict.fromkeys(target.id if i == source.id else i for i in tx.ai_options))
    if goal:
        goal["category_id"] = target.id
        goals_router.put_goals(goals_router.GoalsIn(goals=goals), db)
    db.flush()
    db.expire_all()
    db.delete(db.get(Category, source.id))
    db.commit()


def _starting_plan(db: Session, category: Category) -> Decimal:
    """The starting amount, the row with no month."""
    row = db.query(Budget).filter_by(category_id=category.id, month=None).first()
    return row.planned_amount if row else Decimal("0")


def _goal_in(g: dict) -> dict:
    """A stored goal in the shape the goals endpoint takes, its start date kept."""
    return {"name": g["n"], "category_id": g["c"], "target_cents": g["t"], "start_cents": g.get("s", 0),
            "by": g.get("b"), "started": g.get("d")}


def _set_goal(db: Session, a: dict):
    """Add a savings goal for a category, or change the one it has."""
    goals = [_goal_in(g) for g in goals_router._stored(db)]
    current = next((g for g in goals if g["category_id"] == a.get("category_id")), None)
    if current is None:
        if "name" not in a or "target_cents" not in a:
            raise ActionError("A new savings goal needs a name and a target")
        current = {"category_id": a.get("category_id"), "start_cents": 0, "by": None, "started": None}
        goals.append(current)
    current.update({k: a[k] for k in ("name", "target_cents", "start_cents", "by") if k in a})
    goals_router.put_goals(goals_router.GoalsIn(goals=goals), db)


def _delete_goal(db: Session, a: dict):
    goals = [_goal_in(g) for g in goals_router._stored(db)]
    kept = [g for g in goals if g["category_id"] != a.get("category_id")]
    if len(kept) == len(goals):
        raise ActionError("That category has no savings goal")
    goals_router.put_goals(goals_router.GoalsIn(goals=kept), db)


def _batch_items(a: dict) -> list[tuple[str, dict]]:
    items = a.get("changes")
    if not isinstance(items, list) or not items:
        raise ActionError("A batch needs a list of changes")
    if len(items) > MAX_BATCH:
        raise ActionError(f"A batch can hold at most {MAX_BATCH} changes")
    out = []
    for i, item in enumerate(items, 1):
        if not isinstance(item, dict) or not isinstance(item.get("args"), dict) or item.get("op") not in OPS or item.get("op") == "batch":
            raise ActionError(f"Change {i} in the batch is not a change the app can make")
        out.append((item["op"], item["args"]))
    return out


def _batch(db: Session, a: dict):
    for i, (name, args) in enumerate(_batch_items(a), 1):
        try:
            _run_op(name, args, db)
        except ActionError as e:
            raise ActionError(f"Change {i} in the batch ({name}): {e}") from e


def _prepare_batch(db: Session, a: dict):
    for name, args in _batch_items(a):
        if OPS[name].prepare:
            OPS[name].prepare(db, args)


# ---- Reminders ------------------------------------------------------------------------------------

def _reminder_text(value: Any) -> str:
    text = " ".join(_text(value, "reminder text").split())
    if len(text) > reminders.MAX_TEXT:
        raise ActionError(f"The reminder text is {len(text)} characters long; keep it under {reminders.MAX_TEXT}")
    return text


def _reminder_time(value: Any) -> datetime:
    """'YYYY-MM-DD' (9:00 that day) or 'YYYY-MM-DDTHH:MM', in the household's time."""
    wrong = ActionError("The time is not valid: use YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time of day")
    if not isinstance(value, str):
        raise wrong
    try:
        if len(value.strip()) == 10:
            return datetime.combine(date.fromisoformat(value.strip()), time(reminders.DEFAULT_HOUR))
        at = datetime.fromisoformat(value.strip())
    except ValueError:
        raise wrong from None
    if at.tzinfo is not None:
        raise ActionError("Give the time as the household's own time, without a time zone")
    return reminders.minute(at)


def _reminder_every(value: Any) -> str | None:
    if value is None:
        return None
    if value not in reminders.EVERY:
        raise ActionError("A reminder can repeat every week, month or year; leave it out for a single time")
    return value


def _first_time(anchor: datetime, every: str | None, now: datetime) -> datetime:
    """When a reminder asked for at `anchor` first goes out. A single time in the past is refused; a repeating
    one is moved on to its next time."""
    if every:
        return reminders.next_after(anchor, every, reminders.minute(now), inclusive=True)
    if anchor < reminders.minute(now):
        raise ActionError(
            f"{_when_label(anchor)} has already passed (it is {_when_label(now)} now), so a reminder cannot be set for it. "
            "Ask which later time they mean"
        )
    return anchor


def _add_reminder(db: Session, a: dict):
    now = clock.now()
    anchor, every = _reminder_time(a.get("at")), _reminder_every(a.get("every"))
    db.add(Reminder(
        text=_reminder_text(a.get("text")), anchor_at=anchor, next_at=_first_time(anchor, every, now),
        every=every, created_at=now,
    ))
    db.commit()


def _update_reminder(db: Session, a: dict):
    reminder = _get(db, Reminder, a.get("id"), "reminder")
    if not {"text", "at", "every"} & a.keys():
        raise ActionError("Say what changes about the reminder: text, at or every")
    if reminder.next_at is None:
        raise ActionError("That reminder has already been sent and is finished; add a new reminder instead")
    if "text" in a:
        reminder.text = _reminder_text(a["text"])
    every = _reminder_every(a["every"]) if "every" in a else reminder.every
    if "at" in a or every != reminder.every:
        anchor = _reminder_time(a["at"]) if "at" in a else reminder.next_at
        reminder.anchor_at, reminder.every = anchor, every
        reminder.next_at = _first_time(anchor, every, clock.now())
    db.commit()


def _delete_reminder(db: Session, a: dict):
    db.delete(_get(db, Reminder, a.get("id"), "reminder"))
    db.commit()


def _set_aside_fields(a: dict) -> dict:
    fields = {k: a[k] for k in ("name", "due_month", "every_months") if k in a}
    if "amount_cents" in a:
        fields["amount_cents"] = _cents(a["amount_cents"])
    return fields


def _set_setting(db: Session, a: dict):
    if a.get("key") not in _SETTING_NAMES:
        raise ActionError(
            "Only " + ", ".join(_SETTING_NAMES) + " can be set here; savings goals have goal.set")
    settings_router.patch_setting(a.get("key"), SettingPatch(value=str(a.get("value"))), db)


def _is_manual(tx: Transaction) -> bool:
    return (tx.source.value if hasattr(tx.source, "value") else tx.source) == "manual"


def _delete_transaction(db: Session, a: dict):
    """Remove a manual entry, or an imported bank row (a duplicate, a wrong row). A removed bank row is noted
    (`RemovedBankRow`) so that importing its file again does not bring it back. Its split parts go with it; one
    paid from a set-aside must be unlinked first, so the card shows the set-aside counting it as unpaid again."""
    tx = _get(db, Transaction, a.get("id"), "transaction")
    if _is_manual(tx):
        transactions_router.delete_transaction(tx.id, db)
        return
    if tx.set_aside_id is not None:
        bill = db.get(SetAside, tx.set_aside_id)
        raise ActionError(
            f"The bank row '{tx.description} · {_short_date(tx.date)}' (id {tx.id}) is paid from the set-aside "
            f"'{bill.name if bill else tx.set_aside_id}' (id {tx.set_aside_id}). Unlink it first with set_aside.unpay, "
            "in a batch before transaction.delete"
        )
    if db.get(RemovedBankRow, tx.import_hash) is None:
        db.add(RemovedBankRow(import_hash=tx.import_hash, date=tx.date, amount=tx.amount, description=tx.description))
    db.delete(tx)  # its split parts go with it
    db.commit()


UNDO_DAYS = 7  # an applied card shows its Undo button this long


def _jsonable(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _from_json(column, value):
    """A stored value back in its column's own Python type."""
    if value is None:
        return None
    if isinstance(column.type, DateTime):
        return datetime.fromisoformat(value)
    if isinstance(column.type, Date):
        return date.fromisoformat(value)
    if isinstance(column.type, Numeric) and not isinstance(column.type, Float):
        return Decimal(value)
    return value


def _touched(before: dict, after: dict) -> list[dict]:
    """Every row whose content differs between two snapshots, JSON-safe: [{table, key, before, after}]."""
    rows = []
    for model in _TABLES:
        name = model.__table__.name
        old, new = before[name], after[name]
        for key in sorted(set(old) | set(new), key=str):
            if old.get(key) != new.get(key):
                rows.append({
                    "table": name, "key": key,
                    "before": {k: _jsonable(v) for k, v in old[key].items()} if key in old else None,
                    "after": {k: _jsonable(v) for k, v in new[key].items()} if key in new else None,
                })
    return rows


def _row_now(db: Session, table, key) -> dict | None:
    pk = next(iter(table.primary_key.columns))
    row = db.execute(select(table).where(pk == key)).mappings().first()
    return {k: _jsonable(_plain(v)) for k, v in row.items()} if row is not None else None


def _row_name(db: Session, table_name: str, row: dict) -> str:
    """A row as the household would name it, for a refusal."""
    def when(value) -> str:
        return _short_date(date.fromisoformat(value)) if value else ""

    def category(cid) -> str:
        c = db.get(Category, cid) if cid is not None else None
        return c.name if c else "no category"

    if table_name == "transactions":
        return f"the payment '{row['description']} · {when(row['date'])}'"
    if table_name == "transaction_splits":
        tx = db.get(Transaction, row["transaction_id"])
        return f"the split of the payment '{tx.description} · {_short_date(tx.date)}'" if tx else "a split of a payment"
    if table_name == "categories":
        return f"the category '{row['name']}'"
    if table_name == "rules":
        return f"the rule '{row['pattern']}'"
    if table_name == "budgets":
        month = _month_label(date.fromisoformat(row["month"])) if row.get("month") else "the starting amount"
        return f"the plan for {category(row['category_id'])} in {month}"
    if table_name == "set_asides":
        return f"the set-aside '{row['name']}'"
    if table_name == "ask_shops":
        return f"the shop '{row['pattern']}'"
    if table_name == "ignored_bills":
        return f"the fixed bill '{row['key']}'"
    if table_name == "settings":
        return "the savings goals" if row["key"] == goals_router.KEY else f"the setting '{_SETTING_NAMES.get(row['key'], row['key'])}'"
    if table_name == "removed_bank_rows":
        return f"the removed bank row '{row['description']} · {when(row['date'])}'"
    return f"a row in {table_name}"


def _undo_card(db: Session, a: dict):
    """Put back every row an applied card changed, as it was before; refused when one was changed since."""
    card_id = a.get("card_id")
    record = (db.query(AppliedChange).filter_by(card_id=card_id).first()
              if isinstance(card_id, int) and not isinstance(card_id, bool) else None)
    if record is None:
        raise ActionError(
            f"There is no record of what card {card_id} changed: it was not applied, or it was applied before the app "
            "kept what each card changed, so it cannot be undone"
        )
    if record.undone_at is not None:
        raise ActionError(f"Card {card_id} was already undone")
    tables = {model.__table__.name: model.__table__ for model in _TABLES}
    for entry in record.rows:
        table = tables.get(entry["table"])
        if table is None:
            raise ActionError(f"Card {card_id} changed something the app no longer has, so it cannot be undone")
        now = _row_now(db, table, entry["key"])
        if now != entry["after"]:
            named = _row_name(db, entry["table"], now or entry["after"] or entry["before"])
            raise ActionError(f"{named[0].upper()}{named[1:]} was changed again after that card (card {card_id}), so it cannot be undone")

    def restore(entry) -> dict:
        table = tables[entry["table"]]
        return {c.name: _from_json(c, entry["before"].get(c.name)) for c in table.columns if c.name in entry["before"]}

    def pk(entry):
        return next(iter(tables[entry["table"]].primary_key.columns)) == entry["key"]

    order = [m.__table__.name for m in _TABLES]
    rows = sorted(record.rows, key=lambda e: order.index(e["table"]))
    for entry in reversed(rows):  # what the card added goes first, so nothing it held is in the way
        if entry["before"] is None:
            db.execute(tables[entry["table"]].delete().where(pk(entry)))
    for entry in rows:
        if entry["before"] is not None and entry["after"] is not None:
            db.execute(tables[entry["table"]].update().where(pk(entry)).values(**restore(entry)))
        elif entry["before"] is not None:  # what it removed comes back with its own id
            db.execute(tables[entry["table"]].insert().values(**restore(entry)))
    record.undone_at = clock.now()
    db.commit()


def _record(conn, card_id: int, name: str, rows: list[dict]) -> None:
    conn.execute(AppliedChange.__table__.insert().values(
        card_id=card_id, op=name, rows=rows, applied_at=clock.now()))


@dataclass(frozen=True)
class Op:
    run: Callable[[Session, dict], Any]
    signature: str  # what the prompt tells the model about its arguments
    prepare: Callable[[Session, dict], Any] | None = None


OPS: dict[str, Op] = {
    "transaction.add": Op(_add_transaction,
        '{"date":"YYYY-MM-DD","amount_cents":int (negative=spent, positive=received),"description":str,"category_id":int}'),
    "transaction.update": Op(_update_transaction,
        '{"id":int, then only what changes: "category_id":int,"confirmed":bool,"is_refund":bool; manual entries also "date","amount_cents","description"}'),
    "transaction.split": Op(_split_transaction,
        '{"id":int,"parts":[{"category_id":int,"amount_cents":int,"is_refund":bool optional}]} parts sum exactly to the transaction amount with the same sign; "parts":[] removes a split'),
    "transaction.delete": Op(_delete_transaction,
        '{"id":int} removes a manual entry; an imported bank row only when the person asks for it (a payment that is in twice, a wrong row): a later import of the same file will not bring it back'),
    "refund.book": Op(_book_refund,
        '{"refund_id":int (the incoming payment),"purchase_id":int (the original purchase),"category_id":int only if the purchase is split}'),
    "refund.add": Op(_add_refund,
        '{"purchase_id":int if known otherwise "category_id":int,"amount_cents":int positive,"date":"YYYY-MM-DD","description":str} when the incoming payment is not in the data'),
    "review.confirm": Op(_confirm_guesses, '{"ids":[int,...]} guesses to accept as they stand'),
    "budget.set": Op(_set_budget,
        '{"category_id":int,"month":"YYYY-MM" optional (the current month if left out),"planned_amount_cents":int} the plan from that month on; earlier months keep theirs',
        prepare=_prepare_budget),
    "budget.copy": Op(_copy_budget,
        '{"from_month":"YYYY-MM","to_month":"YYYY-MM" optional (the current month if left out)} every category\'s plan from to_month on becomes what it was in from_month; earlier months keep theirs',
        prepare=_prepare_copy),
    "budget.adjust": Op(_adjust_budget,
        '{"month":"YYYY-MM" optional (the current month if left out), exactly one of "category_ids":[int,...] or "type":"needs|wants|savings", exactly one of "by_pct":int (5 or -10) or "by_cents":int} raises or lowers those categories\' plans from that month on, rounded to whole euros and never below zero',
        prepare=_prepare_adjust),
    "rule.add": Op(lambda db, a: rules_router.create_rule(RuleCreate(**a), db),
        '{"pattern":str,"category_id":int} when several rules fit a payment the longest pattern wins'),
    "rule.update": Op(
        lambda db, a: rules_router.update_rule(a.get("id"), RuleUpdate(**{k: v for k, v in a.items() if k != "id"}), db),
        '{"id":int, then only what changes: "pattern","category_id"}'),
    "rule.delete": Op(lambda db, a: rules_router.delete_rule(a.get("id"), db), '{"id":int}'),
    "shop.always_ask": Op(
        lambda db, a: rules_router.add_ask_shop(rules_router.AskShopIn(transaction_id=a.get("transaction_id")), db),
        '{"transaction_id":int (a payment at the shop)} for a shop whose payments differ every time, such as one that sells a bit of everything: its payments are never sorted by themselves or remembered as a rule, and each is asked about on its own. A rule that sorted the shop is removed. Payments already sorted keep their category'),
    "shop.sort_again": Op(lambda db, a: rules_router.delete_ask_shop(a.get("pattern") or "", db),
        '{"pattern":str (from ask_shops)} undo shop.always_ask: Claude sorts the shop by itself again'),
    "category.add": Op(lambda db, a: categories_router.create_category(CategoryCreate(**a), db),
        '{"name":str,"type":"needs|wants|savings|income|exclude"}'),
    "category.update": Op(
        lambda db, a: categories_router.patch_category(
            a.get("id"), categories_router.CategoryPatch(**{k: v for k, v in a.items() if k in ("name", "type")}), db),
        '{"id":int, then only what changes: "name","type"}'),
    "category.delete": Op(lambda db, a: categories_router.delete_category(a.get("id"), db), '{"id":int}'),
    "category.merge": Op(_merge_category,
        '{"from_id":int,"into_id":int} moves everything of the first category into the second and removes the first: its payments and split parts, its rules (one the second already has is dropped), its savings goal, and its plan, added to the second\'s so the total plan stays the same. Both must be the same type (need, want, saving)'),
    "category.reorder": Op(lambda db, a: categories_router.reorder_categories(CategoryReorder(**a), db),
        '{"category_ids":[int,...]} in the new order'),
    "set_aside.add": Op(
        lambda db, a: set_asides_router.create_set_aside(set_asides_router.SetAsideIn(**_set_aside_fields(a)), db),
        '{"name":str,"amount_cents":int positive,"due_month":"YYYY-MM" (when it is next due),"every_months":int 2-60 or null, optional (how often it comes back: 3 quarterly, 12 yearly (the default), null once)} a bill that does not come monthly, set aside for in equal monthly shares until it is due'),
    "set_aside.update": Op(
        lambda db, a: set_asides_router.patch_set_aside(a.get("id"), set_asides_router.SetAsidePatch(**_set_aside_fields(a)), db),
        '{"id":int, then only what changes: "name","amount_cents","due_month","every_months"}'),
    "set_aside.delete": Op(lambda db, a: set_asides_router.delete_set_aside(a.get("id"), db), '{"id":int}'),
    "set_aside.pay": Op(
        lambda db, a: set_asides_router.pay_from_set_aside(
            a.get("id"), set_asides_router.PaymentIn(transaction_id=a.get("transaction_id")), db),
        '{"id":int (the set-aside),"transaction_id":int (the outgoing payment that is this bill)} the payment then comes out of what was set aside and counts in no month\'s spending'),
    "set_aside.unpay": Op(lambda db, a: set_asides_router.unpay(a.get("id"), a.get("transaction_id"), db),
        '{"id":int,"transaction_id":int} undo set_aside.pay'),
    "bill.ignore": Op(lambda db, a: recurring_router.ignore_bill(recurring_router.BillKey(key=a.get("key") or ""), db),
        '{"key":str (a fixed bill\'s key from upcoming_bills)} stop counting it as a fixed bill still to pay'),
    "bill.count": Op(lambda db, a: recurring_router.count_bill_again(a.get("key") or "", db),
        '{"key":str} count an ignored bill as a fixed bill again'),
    "setting.set": Op(_set_setting,
        '{"key":"financial_month_start_day","value":"1-28"} or {"key":"target_split","value":"needs/wants/savings in whole percent adding up to 100, such as 60/25/15"} or {"key":"own_names","value":"the household\'s own names as the bank shows them, separated by ;"} (money moved to them goes to To personal accounts) or {"key":"nudges","value":"on|off"} (whether the bot writes unasked: recaps, old-data and month-end messages, questions about payments it was unsure of after an import on the Import page) or {"key":"quiet_hours","value":"HH-HH from-until in whole hours, such as 21-9; may pass midnight"} (nothing is sent unasked then) or {"key":"sort_model","value":"sonnet|opus|haiku"} (the Claude model that sorts imported payments)'),
    "goal.set": Op(_set_goal,
        '{"category_id":int (a savings category; one goal each),"name":str,"target_cents":int,"start_cents":int optional (already in the pot when it started),"by":"YYYY-MM" or null optional} adds a goal, or changes the one that category has (then only what changes)'),
    "goal.delete": Op(_delete_goal, '{"category_id":int}'),
    "card.undo": Op(_undo_card,
        '{"card_id":int (an applied card)} puts back everything that card changed, as it was before it was applied; undoing an undo makes the change again'),
    "reminder.add": Op(_add_reminder,
        '{"text":str (what the message says),"at":"YYYY-MM-DD" (9:00 that day) or "YYYY-MM-DDTHH:MM" (household time, in the future),"every":"week"|"month"|"year" optional (repeats; leave out for once)} a message in the Telegram group at that time, held until morning if it falls in the quiet hours. A monthly one on the 29th-31st goes out on the last day of a shorter month'),
    "reminder.update": Op(_update_reminder,
        '{"id":int (from reminders), then only what changes: "text","at","every" ("week","month","year" or null for once)}'),
    "reminder.delete": Op(_delete_reminder, '{"id":int (from reminders)}'),
    "batch": Op(_batch,
        '{"changes":[{"op":str,"args":{...}}, ...]} several of the changes above on one card, applied together or not at all, such as reviewing a group of guesses with review.confirm and transaction.update',
        prepare=_prepare_batch),
}

# Reached only from an import's Merge card, never from the model.
SERVER_OPS: dict[str, Op] = {"merge": Op(_merge, "")}


def _op(name: str) -> Op:
    op = OPS.get(name) or SERVER_OPS.get(name)
    if op is None:
        raise ActionError(f"The app has no change called '{name}'")
    return op


def _run_op(name: str, args: dict, db: Session) -> None:
    try:
        _op(name).run(db, args)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else None
        raise ActionError(detail or "The app did not accept this change") from e
    except ValidationError as e:
        raise ActionError(f"The change was not complete: {e.errors()[0]['msg']}") from e
    except TypeError as e:
        raise ActionError("The change was not complete") from e


# ---- Reading what changed -----------------------------------------------------------------------

def _plain(value):
    return value.value if isinstance(value, enum.Enum) else value


def _snapshot(conn) -> dict[str, dict]:
    tables: dict[str, dict] = {}
    for model in _TABLES:
        table = model.__table__
        key = next(iter(table.primary_key.columns)).name
        tables[table.name] = {
            row[key]: row
            for row in ({k: _plain(v) for k, v in r.items()} for r in conn.execute(select(table)).mappings())
        }
    return tables


def _cents_of(value) -> int:
    return money.to_cents(Decimal(str(value)))


def _flag(v) -> str:
    return "Yes" if v else "No"


def _every(months) -> str:
    """How often a set-aside's bill comes back, in words."""
    if not months:
        return "No, once"
    return "Every year" if months == 12 else f"Every {months} months"


_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _when_label(at: datetime) -> str:
    return f"{_WEEKDAYS[at.weekday()]} {at.day} {_MONTHS[at.month - 1]} {at.year} at {at:%H:%M}"


def _reminder_when(r: dict) -> str:
    if r["next_at"] is None:
        return "Already sent"
    held = " (held until the morning)" if clock.quiet_hours(r["next_at"]) else ""
    return _when_label(r["next_at"]) + held


def _month_label(d: date) -> str:
    return f"{_LONG_MONTHS[d.month - 1]} {d.year}"


class _Names:
    def __init__(self, before: dict, after: dict):
        self.categories = {
            cid: row["name"]
            for snap in (before, after) for cid, row in snap["categories"].items()
        }

        self.set_asides = {
            sid: row["name"]
            for snap in (before, after) for sid, row in snap["set_asides"].items()
        }

    def category(self, cid) -> str:
        return self.categories.get(cid, "None") if cid is not None else "None"

    def set_aside(self, sid) -> str:
        return self.set_asides.get(sid, "No") if sid is not None else "No"


def _splits_of(snap: dict, tx_id: int, names: _Names) -> str:
    parts = [s for s in snap["transaction_splits"].values() if s["transaction_id"] == tx_id]
    parts.sort(key=lambda s: s["id"])
    return " + ".join(
        f"{names.category(s['category_id'])} {eur(_cents_of(s['amount']))}{' (refund)' if s['is_refund'] else ''}"
        for s in parts
    )


def _counts_as(tx: dict) -> str:
    if _cents_of(tx["amount"]) <= 0:
        return "Spending"
    return "Refund" if tx["is_refund"] else "Income"


def _field(label: str, before, after) -> dict:
    return {"label": label, "before": str(before), "after": str(after)}


def _tx_values(tx: dict, snap: dict, names: _Names) -> dict[str, str]:
    split = _splits_of(snap, tx["id"], names)
    return {
        "Date": f"{_short_date(tx['date'])} {tx['date'].year}",
        "Amount": eur(_cents_of(tx["amount"]), signed=True),
        "Description": tx["description"],
        "Counts as": _counts_as(tx),
        "Category": f"Split: {split}" if split else names.category(tx["category_id"]),
        "Reviewed": _flag(tx["confirmed"]),
        "Paid from set-aside": names.set_aside(tx["set_aside_id"]),
    }


def _row_changes(
    title_of: Callable[[dict], str], rows_before: dict, rows_after: dict,
    values_of: Callable[[dict], dict[str, str]], added: str, removed: str,
) -> list[dict]:
    out = []
    for key in sorted(set(rows_before) | set(rows_after)):
        old, new = rows_before.get(key), rows_after.get(key)
        old_values = values_of(old) if old else {}
        new_values = values_of(new) if new else {}
        if old_values == new_values:
            continue
        fields = [
            _field(label, old_values.get(label, _NOTHING), new_values.get(label, _NOTHING))
            for label in (new_values or old_values)
            if old_values.get(label) != new_values.get(label)
        ]
        heading = added if not old else (removed if not new else "")
        out.append({"title": f"{heading}{title_of(new or old)}", "fields": fields})
    return out


def applied_text(changes: list[dict]) -> str:
    """What was really saved, in the app's own words. The model's sentence was only its proposal."""
    return "\n".join(plain({"changes": changes})["lines"])


def _changes(before: dict, after: dict) -> list[dict]:
    names = _Names(before, after)

    def tx_title(tx: dict) -> str:
        # The word joiner keeps a minus sign on the same line as its amount.
        amount = eur(_cents_of(tx["amount"]), signed=True).replace("-", "-\u2060")
        return f"{tx['description']} · {_short_date(tx['date'])} · {amount}"

    out: list[dict] = []
    for tx_id in sorted(set(before["transactions"]) | set(after["transactions"])):
        old, new = before["transactions"].get(tx_id), after["transactions"].get(tx_id)
        old_values = _tx_values(old, before, names) if old else {}
        new_values = _tx_values(new, after, names) if new else {}
        if old_values == new_values:
            continue
        fields = [
            _field(label, old_values.get(label, _NOTHING), new_values.get(label, _NOTHING))
            for label in (new_values or old_values)
            if old_values.get(label) != new_values.get(label)
        ]
        row = new or old
        bank = row["source"] != "manual"
        heading = ("Bank row back: " if bank else "New manual entry: ") if not old else (
            ("Removed bank row: " if bank else "Removed: ") if not new else "")
        changed = {f["label"] for f in fields}
        how = "new" if not old else "removed" if not new else (
            "moved" if "Category" in changed else "confirmed" if changed == {"Reviewed"} and new["confirmed"] else "changed")
        out.append({"title": heading + tx_title(row), "fields": fields, "payment": {
            # A row that is only being added has no id yet that will still be its id at Apply.
            "id": tx_id if old else None, "how": how, "shop": guesses.shop_pattern(row["description"]), "amount_cents": _cents_of(row["amount"]),
            "category": new_values.get("Category") or old_values.get("Category"),
        }})

    out += _row_changes(
        lambda c: c["name"], before["categories"], after["categories"],
        lambda c: {"Name": c["name"], "Type": str(c["type"]), "Position": str(c["sort_order"])},
        "New category: ", "Removed category: ",
    )
    out += _row_changes(
        lambda r: f"Rule “{r['pattern']}”", before["rules"], after["rules"],
        lambda r: {"Pattern": r["pattern"], "Category": names.category(r["category_id"])},
        "New: ", "Removed: ",
    )
    out += _row_changes(
        lambda b: f"Budget for {names.category(b['category_id'])}, "
                  + (_month_label(b["month"]) if b["month"] else "starting amount"),
        before["budgets"], after["budgets"],
        lambda b: {"Planned": eur(_cents_of(b["planned_amount"]))},
        "New: ", "Removed: ",
    )
    out += _row_changes(
        lambda b: f"Set-aside “{b['name']}”", before["set_asides"], after["set_asides"],
        lambda b: {
            "Name": b["name"], "Amount": eur(_cents_of(b["amount"])), "Due": _month_label(b["due_month"]),
            "Comes back": _every(b["every_months"]),
        },
        "New: ", "Removed: ",
    )
    out += _row_changes(
        lambda s: f"Shop “{s['pattern']}”", before["ask_shops"], after["ask_shops"],
        lambda s: {"Always asked about": "Yes"}, "Always ask about: ", "Sorted by Claude again: ",
    )
    out += _row_changes(
        lambda b: f"Fixed bill “{b['key']}”", before["ignored_bills"], after["ignored_bills"],
        lambda b: {"Counted as a fixed bill": "No"}, "No longer counted: ", "Counted again: ",
    )
    # A removed bank row is said on the payment's own line; only one removed or let back on its own is said here.
    with_payment = {
        (new or old)["import_hash"]
        for tx_id in set(before["transactions"]) ^ set(after["transactions"])
        for old, new in [(before["transactions"].get(tx_id), after["transactions"].get(tx_id))]
    }
    out += _row_changes(
        lambda r: f"{r['description']} · {_short_date(r['date'])}",
        {k: v for k, v in before["removed_bank_rows"].items() if k not in with_payment},
        {k: v for k, v in after["removed_bank_rows"].items() if k not in with_payment},
        lambda r: {"Kept out of later imports": "Yes"},
        "Kept out of later imports: ", "Let in by a later import again: ",
    )
    out += _row_changes(
        lambda r: f"Reminder “{r['text']}”", before["reminders"], after["reminders"],
        lambda r: {
            "Name": r["text"], "When": _reminder_when(r),
            "Repeats": f"every {r['every']}" if r["every"] else "once",
        },
        "New: ", "Removed: ",
    )
    plain = lambda snap: {k: v for k, v in snap["settings"].items() if k != goals_router.KEY}  # noqa: E731
    out += _row_changes(
        lambda s: _SETTING_NAMES.get(s["key"], s["key"]),
        plain(before), plain(after), lambda s: {"Value": _setting_value(s)}, "New setting: ", "Removed setting: ",
    )
    out += _row_changes(
        lambda g: f"Savings goal “{g['n']}”", _goals_in(before), _goals_in(after),
        lambda g: {
            "Name": g["n"], "Saved into": names.category(g["c"]), "Target": eur(int(g["t"])),
            "In the pot at the start": eur(int(g.get("s", 0))),
            "By": _month_label(date(int(g["b"][:4]), int(g["b"][5:]), 1)) if g.get("b") else "No date",
        },
        "New: ", "Removed: ",
    )
    return out


def _setting_value(setting: dict) -> str:
    """A setting's value in plain words, where the stored form is terse."""
    value = setting["value"]
    if setting["key"] == "nudges":
        return value.capitalize()
    if setting["key"] == "quiet_hours":
        parsed = runtime_settings.parse_quiet_hours(value)
        return f"from {parsed[0]}:00 until {parsed[1]}:00" if parsed else value
    if setting["key"] == "sort_model":
        return value.capitalize()
    return value


def _goals_in(snap: dict) -> dict:
    row = snap["settings"].get(goals_router.KEY)
    try:
        goals = json.loads(row["value"]) if row else []
    except ValueError:
        goals = []
    return {g["c"]: g for g in goals if isinstance(g, dict) and "c" in g} if isinstance(goals, list) else {}


def _tx_category_ids(tx: dict, snap: dict) -> set[int]:
    split = {s["category_id"] for s in snap["transaction_splits"].values() if s["transaction_id"] == tx["id"]}
    return {c for c in (split or {tx["category_id"]}) if c is not None}


def _affected_months(before: dict, after: dict, db: Session) -> set[tuple[int, int]]:
    """Label months (year, month) whose spend or plan this change touches."""
    start_day = spend_service.get_start_day(db)
    months: set[tuple[int, int]] = set()
    for snap, other in ((before, after), (after, before)):
        for tx_id, tx in snap["transactions"].items():
            if other["transactions"].get(tx_id) != tx or _tx_category_ids(tx, snap) != _tx_category_ids(tx, other):
                months.add(label_month_for_date(tx["date"], start_day))
    for key, budget in after["budgets"].items():
        if before["budgets"].get(key) != budget and budget["month"] is not None:
            months.add((budget["month"].year, budget["month"].month))
    return months


def _totals(db: Session, months: set[tuple[int, int]]) -> dict[tuple, dict]:
    """The Month page's figures for each budgeted category, and for needs, wants and savings."""
    totals: dict[tuple, dict] = {}
    categories = [c for c in db.query(Category).all() if c.type.value in _TYPES_WITH_BUDGET]
    for year, mo in months:
        budget_router._auto_populate(date(year, mo, 1), db)
        start, end = spend_service.financial_month_bounds(db, year, mo)
        spend = spend_service.spend_totals_by_category(spend_service.confirmed_parts_in_range(db, start, end))
        plans = {b.category_id: b.planned_amount for b in db.query(Budget).filter(Budget.month == date(year, mo, 1))}
        for kind in _TYPES_WITH_BUDGET:
            totals[("kind", kind, year, mo)] = {"category": kind.capitalize(), "spent_cents": 0, "planned_cents": 0}
        for category in categories:
            row = {
                "category": category.name,
                "spent_cents": money.to_cents(spend.get(category.id, Decimal("0"))),
                "planned_cents": money.to_cents(plans[category.id]) if category.id in plans else None,
            }
            totals[("category", category.id, year, mo)] = row
            whole = totals[("kind", category.type.value, year, mo)]
            whole["spent_cents"] += row["spent_cents"]
            whole["planned_cents"] += row["planned_cents"] or 0
    return totals


def _effect(
    before: dict, after: dict, label_before: tuple[int, int], label_after: tuple[int, int],
) -> list[dict]:
    """What moved. Named categories first; needs, wants and savings only if no single category tells it.

    "This month" compares the current month on each side, as a start-day change can relabel it.
    """
    def as_current(totals: dict, label: tuple[int, int]) -> dict:
        return {(*k[:2], *((0, 0) if k[2:] == label else k[2:])): v for k, v in totals.items()}

    before, after = as_current(before, label_before), as_current(after, label_after)

    def moved(level: str) -> list[dict]:
        rows = []
        for key in sorted(k for k in set(before) | set(after) if k[0] == level):
            old, new = before.get(key), after.get(key)
            if old == new or new is None or old is None:
                continue
            year, mo = key[2:]
            rows.append({
                "category": new["category"],
                "when": "this month" if (year, mo) == (0, 0) else f"in {_LONG_MONTHS[mo - 1]} {year}",
                "before_cents": old["spent_cents"],
                "after_cents": new["spent_cents"],
                "planned_before_cents": old["planned_cents"],
                "planned_cents": new["planned_cents"],
            })
        return rows

    return moved("category") or moved("kind")


def _purchase(name: str, args: dict, db: Session) -> dict | None:
    if name not in ("refund.book", "refund.add") or args.get("purchase_id") is None:
        return None
    purchase = db.get(Transaction, args["purchase_id"])
    return describe_transaction(purchase) if purchase else None


# ---- Preview and apply --------------------------------------------------------------------------

def _execute(
    name: str, args: dict, on_commit: Callable[[Any, dict], None] | None,
    precheck: Callable[[Any], None] | None = None, card_id: int | None = None,
) -> dict:
    """Run the action in one transaction. Without on_commit it is only a preview.

    The session's commits (the routers') become savepoints, so nothing lands until the end.
    The write lock is taken first, so two taps on Apply run one after the other; precheck then
    stops the second before it touches anything. With a card_id, what the change did to each row is
    kept (`AppliedChange`) in the same transaction, so card.undo can put it back.
    """
    with database.engine.connect() as conn:
        conn.exec_driver_sql("BEGIN IMMEDIATE")
        session = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        try:
            if precheck:
                precheck(conn)
            prepare = _op(name).prepare
            if prepare:
                prepare(session, args)
            start_day = spend_service.get_start_day(session)
            this_month = label_month_for_date(clock.today(), start_day)
            before = _snapshot(conn)

            # The session's own savepoint must not enclose this one, or its commits would end it.
            session.commit()
            conn.execute(sql("SAVEPOINT chat_preview"))
            _run_op(name, args, session)
            after = _snapshot(conn)
            this_month_after = label_month_for_date(clock.today(), spend_service.get_start_day(session))
            months = _affected_months(before, after, session) | {this_month, this_month_after}
            changes = _changes(before, after)
            if not changes:
                raise ActionError("That would not change anything")
            totals_after = _totals(session, months)
            purchase = _purchase(name, args, session)

            session.close()
            conn.execute(sql("ROLLBACK TO SAVEPOINT chat_preview"))
            session = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
            totals_before = _totals(session, months)
            if purchase is None:
                purchase = _purchase(name, args, session)
            preview = {"changes": changes, "purchase": purchase,
                       "effect": _effect(totals_before, totals_after, this_month, this_month_after)}
            if on_commit is None:
                conn.rollback()
                return preview

            before_apply = _snapshot(conn) if card_id is not None else None
            _run_op(name, args, session)
            session.close()
            on_commit(conn, preview)
            if card_id is not None:
                _record(conn, card_id, name, _touched(before_apply, _snapshot(conn)))
            conn.commit()
            return preview
        except BaseException:
            session.close()
            conn.rollback()
            raise


def preview(name: str, args: dict) -> dict:
    return _execute(name, args, None)


def apply(
    name: str, args: dict, shown: dict, on_commit: Callable[[Any, dict], None],
    precheck: Callable[[Any], None], card_id: int | None = None,
) -> dict:
    """Commit the action if it still does what the card showed; on_commit runs in the same transaction, and so does
    keeping what it changed for card `card_id`, so that it can be undone."""
    def checked(conn, fresh: dict) -> None:
        if fresh["changes"] != shown["changes"]:
            raise StaleProposal(fresh)
        on_commit(conn, fresh)

    return _execute(name, args, checked, precheck, card_id)


# ---- The card in plain words --------------------------------------------------------------------

SIMPLE_CHANGES = 3  # up to this many changes are said one line each; more are summed up per category
_GROUP_LINES = 12
_SHOPS = 3
_OTHER_LINES = 4
_EFFECT_LINES = 3
_REMEMBERED, _OTHER = "Remembered for next time", "Other changes"
_ACTIONS = {"confirmed": "Confirm as", "moved": "Move to", "new": "Add to", "removed": "Remove from", "changed": "Change in"}


def _plain_line(change: dict) -> str:
    """One change in one line, in the app's own words."""
    fields = {f["label"]: f for f in change["fields"]}
    payment = change.get("payment")
    title = change["title"]
    if payment:
        if payment["how"] == "new":
            refund = fields.get("Counts as", {}).get("after") == "Refund"
            title = title.replace("New manual entry: ", "Add: ").replace("Bank row back: ", "Bring back the bank row: ")
            return f"{title}, {'a refund in' if refund else 'in'} {payment['category']}"
        if payment["how"] == "removed":
            if title.startswith("Removed bank row: "):
                return title.replace("Removed bank row: ", "Remove the bank row: ") + " (a later import will not bring it back)"
            return title.replace("Removed: ", "Remove: ")
        if payment["how"] == "confirmed":
            return f"{title}: confirmed as {payment['category']}"
        said = []
        for label, f in fields.items():
            if label == "Reviewed":
                continue
            if label == "Category":
                said.append(f"{f['before']} → {f['after']}" if f["before"] != "None" else f"now {f['after']}")
            elif label == "Counts as":
                said.append(f"counts as a {f['after'].lower()}" if f["after"] == "Refund" else f"counts as {f['after'].lower()}")
            elif label == "Paid from set-aside":
                said.append(f"paid from {f['after']}" if f["after"] != "No" else "no longer paid from a set-aside")
            else:
                said.append(f"{label.lower()} {f['before']} → {f['after']}")
        return f"{title}: {', '.join(said) or 'confirmed'}"
    if all(f["before"] == _NOTHING for f in change["fields"]):
        wanted = [f["after"] for f in change["fields"] if f["label"] not in ("Name", "Pattern", "Position", "Every year")]
        return f"{title}: {', '.join(wanted)}" if wanted else title
    if all(f["after"] == _NOTHING for f in change["fields"]):
        return title
    return f"{title}: " + ", ".join(f"{f['label'].lower()} {f['before']} → {f['after']}" for f in change["fields"])


def _count(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


_REMOVED_CATEGORY = "Removed category: "


def _removal_lines(others: list[dict]) -> list[str]:
    """What a category's removal does besides moving its payments (a merge): its rules, plan and goal."""
    def after(change: dict, label: str) -> str:
        return next(f["after"] for f in change["fields"] if f["label"] == label)

    def starts(*prefixes: str) -> list[dict]:
        return [c for c in others if c["title"].startswith(prefixes)]

    lines = [f"• Removes {c['title'].removeprefix(_REMOVED_CATEGORY)}" for c in starts(_REMOVED_CATEGORY)]
    moved, dropped = starts("Rule "), starts("Removed: Rule")
    if moved:
        lines.append(f"• {_count(len(moved), 'rule')} now point{'s' if len(moved) == 1 else ''} to {after(moved[0], 'Category')}")
    if dropped:
        lines.append(f"• {_count(len(dropped), 'rule')} dropped that the other category has already")
    plans = starts("Budget for ", "New: Budget for ")
    if plans:
        name = plans[0]["title"].removeprefix("New: ").removeprefix("Budget for ").rsplit(", ", 1)[0]
        lines.append(f"• Its plan is added to the plan of {name}, in {_count(len(plans), 'month')}")
    lines += [f"• The savings goal {c['title'].removeprefix('Savings goal ')} now saves into {after(c, 'Saved into')}"
              for c in starts("Savings goal ") if any(f["label"] == "Saved into" for f in c["fields"])]
    return lines


def _summed_up(payments: list[dict], others: list[dict], shops_named: bool = True) -> list[str]:
    """Many changes, summed up per category with counts and totals, and the shops that weigh most
    when `shops_named`."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for change in payments:
        groups.setdefault((change["payment"]["how"], change["payment"]["category"]), []).append(change)
    lines = []
    ordered = sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))
    for (how, category), rows in ordered[:_GROUP_LINES]:
        total = sum(abs(r["payment"]["amount_cents"]) for r in rows)
        shops: dict[str, int] = {}
        for r in rows:
            shops[r["payment"]["shop"]] = shops.get(r["payment"]["shop"], 0) + 1
        top = sorted(shops.items(), key=lambda item: (-item[1], item[0]))
        named = ", ".join(f"{shop}{f' ×{n}' if n > 1 else ''}" for shop, n in top[:_SHOPS])
        if len(top) > _SHOPS:
            named += f" and {len(top) - _SHOPS} more"
        lines.append(f"• {_ACTIONS[how]} {category}: {_count(len(rows), 'payment')}, {eur(total)}"
                     + (f" ({named})" if shops_named else ""))
    if len(ordered) > _GROUP_LINES:
        rest = [r for _, rows in ordered[_GROUP_LINES:] for r in rows]
        lines.append(f"• And {_count(len(rest), 'payment')} in {_count(len(ordered) - _GROUP_LINES, 'other group')}")
    if any(c["title"].startswith(_REMOVED_CATEGORY) for c in others):
        return lines + _removal_lines(others)
    rules = [c for c in others if c["title"].startswith(("New: Rule", "Rule "))]
    rest = [c for c in others if c not in rules]
    if rules:
        lines.append(f"• Remembers {_count(len(rules), 'shop')} for next time")
    lines += [f"• {_plain_line(c)}" for c in rest[:_OTHER_LINES]]
    if len(rest) > _OTHER_LINES:
        lines.append(f"• And {_count(len(rest) - _OTHER_LINES, 'other change')}")
    return lines


def plain(preview: dict) -> dict:
    """What a card says: a line per change when there are few, a summary per category when there are many.

    `summed_up` tells the chats that the rows themselves are only shown when asked for.
    """
    changes = preview["changes"]
    payments = [c for c in changes if c.get("payment")]
    others = [c for c in changes if not c.get("payment")]
    # A remembered shop comes with nearly every confirmation; it is not a change of its own to read through.
    removing = any(c["title"].startswith(_REMOVED_CATEGORY) for c in others)
    remembered = [c for c in others if payments and not removing and c["title"].startswith(("New: Rule", "Rule "))]
    told = [c for c in changes if c not in remembered]
    if len(told) <= SIMPLE_CHANGES:
        lines = [_plain_line(c) for c in told]
        if remembered:
            lines.append("Remembered for next time." if len(remembered) == 1 else f"Remembers {len(remembered)} shops for next time.")
        return {"lines": lines, "summed_up": False, "rows": len(changes), "payments": len(payments)}
    head = _count(len(payments), "payment") if payments else _count(len(changes), "change")
    return {
        "lines": [f"{head}:", *_summed_up(payments, others)], "summed_up": True, "rows": len(changes),
        "payments": len(payments),
        # The same without the shops, for a chat that keeps a card short, and one sentence for once it is applied.
        "head": head, "short_lines": _summed_up(payments, others, shops_named=False),
        "applied_line": _applied_line(payments, len(changes)),
    }


def _applied_line(payments: list[dict], changes: int) -> str:
    """A card with many changes, once applied, in one sentence."""
    sorted_now = [c for c in payments if c["payment"]["how"] in ("moved", "confirmed")]
    said = []
    if sorted_now:
        categories = {c["payment"]["category"] for c in sorted_now}
        total = eur(sum(abs(c["payment"]["amount_cents"]) for c in sorted_now))
        one = len(sorted_now) == 1
        where = f"in {categories.pop()}" if len(categories) == 1 else f"sorted, in {len(categories)} categories"
        said.append(f"{_count(len(sorted_now), 'payment')} {'is' if one else 'are'} now {where}, {total} in all")
    rest = changes - len(sorted_now)
    if rest:
        said.append(f"{_count(rest, 'other change')} made" if said else f"{_count(rest, 'change')} made")
    return " and ".join(said) + "."


def plain_effect(effect: list[dict], applied: bool = False) -> list[str]:
    """What the change does to this month's budget lines, the biggest moves first; other months are counted."""
    def line(item: dict) -> str:
        planned = f" of {eur(item['planned_cents'])}" if item["planned_cents"] is not None else ""
        label = f"{item['category']} {item['when']}"
        if applied:
            return f"{label}: {eur(item['after_cents'])}{planned}"
        return f"{label}: {eur(item['before_cents'])} → {eur(item['after_cents'])}{planned}"

    now = sorted((e for e in effect if e["when"] == "this month"),
                 key=lambda e: -abs(e["after_cents"] - e["before_cents"]))
    shown = now[:_EFFECT_LINES] if now else effect[:_EFFECT_LINES]
    lines = [line(e) for e in shown]
    if len(effect) > len(shown):
        lines.append(f"And {_count(len(effect) - len(shown), 'other budget line')} in this or other months.")
    return lines


def detail_groups(preview: dict) -> list[dict]:
    """Every row of a card, grouped by what changes: a group of payments has `rows` (when, amount,
    name), any other group has `lines`."""
    groups: dict[str, dict] = {}
    for change in preview["changes"]:
        fields = {f["label"]: f for f in change["fields"]}
        payment = change.get("payment")
        if payment and payment["how"] in ("moved", "confirmed") and set(fields) <= {"Category", "Reviewed"}:
            name, when, amount = change["title"].rsplit(" · ", 2)
            if payment["how"] == "confirmed":
                heading = f"Confirmed as {payment['category']}"
            elif fields["Category"]["before"] == "None":
                heading = f"Now {fields['Category']['after']}"
            else:
                heading = f"{fields['Category']['before']} → {fields['Category']['after']}"
            groups.setdefault(heading, {"heading": heading, "rows": []})["rows"].append(
                {"when": when, "amount": amount, "name": name})
            continue
        if change["title"].startswith("New: Rule") and "Pattern" in fields and "Category" in fields:
            heading, line = _REMEMBERED, f"“{fields['Pattern']['after']}” → {fields['Category']['after']}"
        else:
            heading, line = _OTHER, _plain_line(change)
        groups.setdefault(heading, {"heading": heading, "lines": []})["lines"].append(line)
    last = (_REMEMBERED, _OTHER)
    return sorted(groups.values(), key=lambda g: (
        last.index(g["heading"]) + 1 if g["heading"] in last else 0, -len(g.get("rows") or g["lines"])))


def details(preview: dict) -> str:
    """Every row of a card as plain text, for when a person asks to see them all: grouped by what
    changes, with one short line per payment."""
    groups = detail_groups(preview)
    if [g["heading"] for g in groups] == [_OTHER]:
        return "\n".join(f"• {line}" for line in groups[0]["lines"])
    said = []
    for group in groups:
        lines = group.get("lines") or [f"{r['when']} · {r['amount']} · {r['name']}" for r in group["rows"]]
        said.append("\n".join([f"{group['heading']} ({len(lines)})", *[f"• {line}" for line in lines]]))
    return "\n\n".join(said)
