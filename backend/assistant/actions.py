"""Every change the chat can make, and how a change is previewed and applied.

An action runs the same router code as the app. A preview runs it inside a database transaction,
compares the tables before and after, and rolls back, so the card shows what would really happen.
Applying runs it again and commits only if the outcome still matches what the person saw.
"""
import enum
import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text as sql
from sqlalchemy.orm import Session

import db as database
import money
import spend_service
from financial_month import label_month_for_date
from models import Budget, Category, Rule, Setting, StandingAdjustment, Transaction, TransactionSplit
from routers import budget as budget_router
from routers import categories as categories_router
from routers import goals as goals_router
from routers import rules as rules_router
from routers import settings as settings_router
from routers import standing_adjustments as standing_router
from routers import transactions as transactions_router
from schemas import (
    AdjustmentPairCreate, BudgetPatch, CategoryCreate, CategoryReorder, RuleCreate, RuleUpdate,
    SettingPatch, StandingAdjustmentCreate, StandingAdjustmentPatch, TransactionCreate,
)

_NOTHING = "—"
_APPLIED_ROWS = 5
_APPLIED_LINE = 240
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_LONG_MONTHS = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
]
_TYPES_WITH_BUDGET = ("needs", "wants", "savings")
MAX_BATCH = 500
_TABLES = (Transaction, TransactionSplit, Category, Rule, Budget, StandingAdjustment, Setting)


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
        if not is_manual or tx.standing_adjustment_id is not None:
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
    for tx_id in ids:
        tx = _get(db, Transaction, tx_id, f"transaction (id {tx_id})")
        if tx.confirmed or not (tx.category_id or tx.splits):
            raise ActionError(f"Row {tx.id} ('{tx.description}') is not a guess waiting for review")
        tx.confirmed = True
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
    if a.get("month") is None:
        budget_router.patch_default(a.get("category_id"), body, db)
        return
    year, mo = _month(a["month"])
    row = db.query(Budget).filter_by(category_id=a.get("category_id"), month=date(year, mo, 1)).first()
    if row is None:
        raise ActionError("That category has no budget for that month")
    budget_router.patch_budget(row.id, body, db)


def _prepare_budget(db: Session, a: dict):
    if a.get("month") is not None:
        year, mo = _month(a["month"])
        budget_router._auto_populate(date(year, mo, 1), db)


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


def _standing_fields(a: dict) -> dict:
    fields = {k: a[k] for k in ("name", "income_category_id", "expense_category_id", "active") if k in a}
    if "amount_cents" in a:
        fields["amount_cents"] = _cents(a["amount_cents"])
    if "start_month" in a:
        year, mo = _month(a["start_month"])
        fields["start_month"] = date(year, mo, 1)
    return fields


def _set_setting(db: Session, a: dict):
    if a.get("key") != "financial_month_start_day":
        raise ActionError("Only the financial month start day can be set here; savings goals have goal.set")
    settings_router.patch_setting(a.get("key"), SettingPatch(value=str(a.get("value"))), db)


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
    "transaction.delete": Op(lambda db, a: transactions_router.delete_transaction(a.get("id"), db),
        '{"id":int} manual entries only'),
    "transaction.rule": Op(lambda db, a: transactions_router.create_rule_from_transaction(a.get("id"), db),
        '{"id":int} make a rule from this transaction\'s description and category'),
    "adjustment_pair.add": Op(
        lambda db, a: transactions_router.create_adjustment_pair(AdjustmentPairCreate(**{
            **a, "legs": [{**leg, "amount_cents": _cents(leg.get("amount_cents"))} for leg in a.get("legs", [])],
        }), db),
        '{"date":"YYYY-MM-DD","description":str,"legs":[{"amount_cents":int,"category_id":int,"description":str optional},{...}]} two legs netting to zero'),
    "refund.book": Op(_book_refund,
        '{"refund_id":int (the incoming payment),"purchase_id":int (the original purchase),"category_id":int only if the purchase is split}'),
    "refund.add": Op(_add_refund,
        '{"purchase_id":int if known otherwise "category_id":int,"amount_cents":int positive,"date":"YYYY-MM-DD","description":str} when the incoming payment is not in the data'),
    "review.confirm": Op(_confirm_guesses, '{"ids":[int,...]} guesses to accept as they stand'),
    "budget.set": Op(_set_budget,
        '{"category_id":int,"month":"YYYY-MM" or null for the default of future months,"planned_amount_cents":int}',
        prepare=_prepare_budget),
    "rule.add": Op(lambda db, a: rules_router.create_rule(RuleCreate(**a), db),
        '{"pattern":str,"category_id":int,"priority":int optional}'),
    "rule.update": Op(
        lambda db, a: rules_router.update_rule(a.get("id"), RuleUpdate(**{k: v for k, v in a.items() if k != "id"}), db),
        '{"id":int, then only what changes: "pattern","category_id","priority"}'),
    "rule.delete": Op(lambda db, a: rules_router.delete_rule(a.get("id"), db), '{"id":int}'),
    "category.add": Op(lambda db, a: categories_router.create_category(CategoryCreate(**a), db),
        '{"name":str,"type":"needs|wants|savings|income|exclude"}'),
    "category.update": Op(
        lambda db, a: categories_router.patch_category(
            a.get("id"), categories_router.CategoryPatch(**{k: v for k, v in a.items() if k in ("name", "type")}), db),
        '{"id":int, then only what changes: "name","type"}'),
    "category.delete": Op(lambda db, a: categories_router.delete_category(a.get("id"), db), '{"id":int}'),
    "category.reorder": Op(lambda db, a: categories_router.reorder_categories(CategoryReorder(**a), db),
        '{"category_ids":[int,...]} in the new order'),
    "standing.add": Op(
        lambda db, a: standing_router.create_standing_adjustment(StandingAdjustmentCreate(**_standing_fields(a)), db),
        '{"name":str,"amount_cents":int positive,"income_category_id":int,"expense_category_id":int,"start_month":"YYYY-MM" optional}'),
    "standing.update": Op(
        lambda db, a: standing_router.patch_standing_adjustment(a.get("id"), StandingAdjustmentPatch(**_standing_fields(a)), db),
        '{"id":int, then only what changes: "name","amount_cents","income_category_id","expense_category_id","active","start_month"}'),
    "standing.delete": Op(lambda db, a: standing_router.delete_standing_adjustment(a.get("id"), db), '{"id":int}'),
    "setting.set": Op(_set_setting, '{"key":"financial_month_start_day","value":"1-28"}'),
    "goal.set": Op(_set_goal,
        '{"category_id":int (a savings category; one goal each),"name":str,"target_cents":int,"start_cents":int optional (already in the pot when it started),"by":"YYYY-MM" or null optional} adds a goal, or changes the one that category has (then only what changes)'),
    "goal.delete": Op(_delete_goal, '{"category_id":int}'),
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


def _month_label(d: date) -> str:
    return f"{_LONG_MONTHS[d.month - 1]} {d.year}"


class _Names:
    def __init__(self, before: dict, after: dict):
        self.categories = {
            cid: row["name"]
            for snap in (before, after) for cid, row in snap["categories"].items()
        }

    def category(self, cid) -> str:
        return self.categories.get(cid, "None") if cid is not None else "None"


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


def _short(line: str) -> str:
    return line if len(line) <= _APPLIED_LINE else line[:_APPLIED_LINE] + "…"


def applied_text(changes: list[dict]) -> str:
    """What was really saved, in the app's own words. The model's sentence was only its proposal."""
    lines = []
    for change in changes[:_APPLIED_ROWS]:
        lines.append(_short(change["title"]))
        title = change["title"].replace("\u2060", "")
        details = []
        for field in change["fields"]:
            added, removed = field["before"] == _NOTHING, field["after"] == _NOTHING
            value = field["before"] if removed else field["after"]
            if not added and not removed:
                details.append(f"{field['label']}: {field['before']} → {field['after']}")
            elif field["label"] != "Date" and value not in title:  # a row's title already names it
                details.append(f"{field['label']}: {value}")
        if details:
            lines.append(_short(", ".join(details)))
    if len(changes) > _APPLIED_ROWS:
        lines.append(f"And {len(changes) - _APPLIED_ROWS} more.")
    return "\n".join(lines)


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
        heading = "New manual entry: " if not old else ("Removed: " if not new else "")
        out.append({"title": heading + tx_title(new or old), "fields": fields})

    out += _row_changes(
        lambda c: c["name"], before["categories"], after["categories"],
        lambda c: {"Name": c["name"], "Type": str(c["type"]), "Position": str(c["sort_order"])},
        "New category: ", "Removed category: ",
    )
    out += _row_changes(
        lambda r: f"Rule “{r['pattern']}”", before["rules"], after["rules"],
        lambda r: {"Pattern": r["pattern"], "Category": names.category(r["category_id"]), "Priority": str(r["priority"])},
        "New: ", "Removed: ",
    )
    out += _row_changes(
        lambda b: f"Budget for {names.category(b['category_id'])}, "
                  + (_month_label(b["month"]) if b["month"] else "default for future months"),
        before["budgets"], after["budgets"],
        lambda b: {"Planned": eur(_cents_of(b["planned_amount"]))},
        "New: ", "Removed: ",
    )
    out += _row_changes(
        lambda s: f"Standing adjustment “{s['name']}”",
        before["standing_adjustments"], after["standing_adjustments"],
        lambda s: {
            "Name": s["name"], "Amount": eur(_cents_of(s["amount"])),
            "Income category": names.category(s["income_category_id"]),
            "Expense category": names.category(s["expense_category_id"]),
            "Active": _flag(s["active"]), "First month": _month_label(s["start_month"]),
        },
        "New: ", "Removed: ",
    )
    plain = lambda snap: {k: v for k, v in snap["settings"].items() if k != goals_router.KEY}  # noqa: E731
    out += _row_changes(
        lambda s: {"financial_month_start_day": "Financial month start day"}.get(s["key"], s["key"]),
        plain(before), plain(after), lambda s: {"Value": s["value"]}, "New setting: ", "Removed setting: ",
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
        start, end = spend_service.financial_month_bounds(db, year, mo, materialise=True)
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
    precheck: Callable[[Any], None] | None = None,
) -> dict:
    """Run the action in one transaction. Without on_commit it is only a preview.

    The session's commits (the routers') become savepoints, so nothing lands until the end.
    The write lock is taken first, so two taps on Apply run one after the other; precheck then
    stops the second before it touches anything.
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
            this_month = label_month_for_date(date.today(), start_day)
            before = _snapshot(conn)

            # The session's own savepoint must not enclose this one, or its commits would end it.
            session.commit()
            conn.execute(sql("SAVEPOINT chat_preview"))
            _run_op(name, args, session)
            after = _snapshot(conn)
            this_month_after = label_month_for_date(date.today(), spend_service.get_start_day(session))
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

            _run_op(name, args, session)
            session.close()
            on_commit(conn, preview)
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
    precheck: Callable[[Any], None],
) -> dict:
    """Commit the action if it still does what the card showed; on_commit runs in the same transaction."""
    def checked(conn, fresh: dict) -> None:
        if fresh["changes"] != shown["changes"]:
            raise StaleProposal(fresh)
        on_commit(conn, fresh)

    return _execute(name, args, checked, precheck)
