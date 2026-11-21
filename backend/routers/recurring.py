"""Repeating payments found in the bank history: what is still to pay this financial month.

Read-only and derived on every call, nothing is stored. A payment counts as repeating once the same
description has come in at least three times on a regular day (weekly to yearly), always for a similar
amount. Only confirmed expenses count; refunds, splits, bills paid from a set-aside and exclude-type
categories are left out. A payment a person marked as not a fixed bill is listed apart and not counted.

A person can add a fixed bill the payments do not show (`added_bills`): it counts for the months it is due
until a confirmed outgoing payment whose description contains its `matches` text comes within SETTLE_DAYS of
the date; such payments belong to it and are left out of the scan. A found bill can be given another amount
or day (`bill_changes`), which the scan uses instead of what the payments show.

A row never claims more than the bank files can show: when the files stop short of a date, a payment
due by then is "expected", not missing, and a payment is only "stopped" once the files reach well past
the date it should have come.
"""
import calendar
import re
from datetime import date, datetime, timedelta
from statistics import median_low

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

import clock
import money
import spend_service
from db import get_db
from financial_month import label_month_for_date
from models import AddedBill, BillChange, Category, IgnoredBill, Transaction, TransactionSource

router = APIRouter(prefix="/recurring", tags=["recurring"])

# name, nominal days between payments, months between payments (0 = counted in days)
CADENCES = (
    ("weekly", 7, 0),
    ("fortnightly", 14, 0),
    ("monthly", 30, 1),
    ("quarterly", 91, 3),
    ("yearly", 365, 12),
)
MIN_PAYMENTS = 3
AMOUNT_SPREAD = 0.25  # every payment within 25% of the median (energy may vary)
STEADY_SPREAD = 0.01  # payments this close are "the same price"
STOP_AFTER = 1.6  # cadences of silence, with bank files reaching past it, before "stopped"
BEHIND_DAYS = 7  # bank files further behind than this can't say what has been paid
BANK_SOURCES = (TransactionSource.ing,)
SETTLE_DAYS = 10  # a matching payment this close to an added bill's date settles it
ADDED = "added-"  # the key of an added bill is this and its id
MIN_MATCH = 3
BILL_TYPES = ("needs", "wants")
EVERY = {1: "monthly", 3: "quarterly", 12: "yearly"}
ORDER = {"due": 0, "expected": 1, "paid": 2, "later": 3, "stopped": 4, "ignored": 5}


def _today() -> date:
    return clock.today()


def _key(description: str) -> str:
    words = re.sub(r"[^a-z ]+", " ", description.lower()).split()
    return " ".join(words[:3])


def _name(description: str) -> str:
    text = " ".join(description.split())
    return text if len(text) <= 48 else text[:47].rstrip() + "…"


def _add_months(d: date, months: int) -> date:
    index = d.year * 12 + d.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(d.day, calendar.monthrange(year, month + 1)[1]))


def _step(d: date, cadence: tuple[str, int, int]) -> date:
    _, days, months = cadence
    return _add_months(d, months) if months else d + timedelta(days=days)


def _on_day(d: date, day: int) -> date:
    """That month's `day`, or its last day when the month is shorter."""
    return date(d.year, d.month, min(day, calendar.monthrange(d.year, d.month)[1]))


def _months_on(d: date, months: int, day: int) -> date:
    return _on_day(_add_months(d.replace(day=1), months), day)


def _moved_to(nxt: date, last: date, day: int) -> date:
    """The date on `day` nearest to when the payments say the next one comes, after the last payment."""
    options = [_months_on(nxt, k, day) for k in (-1, 0, 1)]
    return min((d for d in options if d > last), key=lambda d: abs((d - nxt).days))


def _cadence_of(gap: int):
    """The cadence a gap in days belongs to, or None. Short cadences allow a narrower wobble."""
    best = min(CADENCES, key=lambda c: abs(gap - c[1]))
    return best if abs(gap - best[1]) <= min(4, round(best[1] * 0.15)) else None


def _cents(tx: Transaction, income: bool = False) -> int:
    """What a payment is worth, positive: expenses are stored negative, income positive."""
    return money.to_cents(tx.amount) if income else -money.to_cents(tx.amount)


def _regular_run(txs: list[Transaction], income: bool = False):
    """The newest unbroken run of payments on one cadence, (cadence, payments), or None."""
    if len(txs) < MIN_PAYMENTS:
        return None
    cadence = _cadence_of((txs[-1].date - txs[-2].date).days)
    if cadence is None:
        return None
    wobble = min(4, round(cadence[1] * 0.15))
    run = [txs[-1], txs[-2]]
    for tx in reversed(txs[:-2]):
        if abs((run[-1].date - tx.date).days - cadence[1]) > wobble:
            break
        run.append(tx)
    run.reverse()
    cents = lambda t: _cents(t, income)  # noqa: E731
    # Weekly and fortnightly payments must cost the same each time; shopping trips that happen to
    # land a week apart vary.
    spread = AMOUNT_SPREAD if cadence[1] >= 30 else STEADY_SPREAD
    while len(run) >= MIN_PAYMENTS:
        mid = median_low([cents(t) for t in run])
        if all(abs(cents(t) - mid) <= mid * spread for t in run):
            return cadence, run
        run = run[1:]
    return None


def _steady_tail(cents: list[int]) -> list[int]:
    """The newest payments that all cost about what the last one did."""
    tail = [cents[-1]]
    for c in reversed(cents[:-1]):
        if abs(c - cents[-1]) > cents[-1] * STEADY_SPREAD:
            break
        tail.append(c)
    return tail[::-1]


def _price(cents: list[int]) -> tuple[int, dict | None]:
    """What the payment costs now, and the rise if the price went up in the last two payments."""
    now = _steady_tail(cents)
    before = cents[: len(cents) - len(now)]
    was = _steady_tail(before) if before else []
    if len(was) >= 2 and len(now) <= 2:
        from_cents, to_cents = median_low(was), median_low(now)
        if to_cents > from_cents * (1 + STEADY_SPREAD):
            return to_cents, {"from_cents": from_cents, "to_cents": to_cents}
        return to_cents, None
    return (median_low(now) if len(now) >= 2 else median_low(cents)), None


def _parse_month(db: Session, month: str | None, today: date) -> tuple[int, int]:
    if month is None:
        return label_month_for_date(today, spend_service.get_start_day(db))
    try:
        parsed = datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")
    return parsed.year, parsed.month


@router.get("")
def recurring(month: str | None = Query(None), db: Session = Depends(get_db)):
    """Repeating payments for one financial month (default: the current one), as of today or the month's end."""
    return _scan(month, db, income=False)


def expected_income(month: str | None, db: Session) -> dict:
    """The same scan for money coming in (a salary): what is still to arrive this financial month.

    Only confirmed positive rows in income categories count, on a regular cadence and a similar amount.
    A person's "not a fixed bill" does not apply to it.
    """
    scan = _scan(month, db, income=True)
    waiting = [i for i in scan["items"] if i["state"] in ("due", "expected")]
    return {
        "items": waiting,
        "expected_cents": sum(i["amount_cents"] * i["remaining"] for i in waiting),
    }


def _scan(month: str | None, db: Session, income: bool) -> dict:
    today = _today()
    year, mo = _parse_month(db, month, today)
    start, end = spend_service.financial_month_bounds(db, year, mo)
    asof = min(today, end)

    added = [] if income else db.query(AddedBill).order_by(AddedBill.id).all()
    rows = (
        db.query(Transaction)
        .options(joinedload(Transaction.category), joinedload(Transaction.splits))
        .filter(Transaction.confirmed == True, Transaction.date <= asof)  # noqa: E712 - historic form
        .order_by(Transaction.date, Transaction.id)
        .all()
    )
    bank_reach: dict[TransactionSource, date] = {}
    groups: dict[str, list[Transaction]] = {}
    for tx in rows:
        if tx.source in BANK_SOURCES:
            bank_reach[tx.source] = tx.date  # rows run oldest first
        category = tx.category
        kinds = ("income",) if income else ("needs", "wants", "savings")
        if (
            (tx.amount <= 0 if income else tx.amount >= 0) or tx.is_refund or tx.splits
            or tx.set_aside_id is not None or category is None or category.type.value not in kinds
        ):
            continue
        if any(_pays(bill, tx) for bill in added):
            continue  # a payment of a bill added by hand belongs to that bill
        key = _key(tx.description)
        if key:
            groups.setdefault(key, []).append(tx)

    latest = max(bank_reach.values(), default=None)
    behind = latest is None or (asof - latest).days > BEHIND_DAYS

    ignored = set() if income else {row.key for row in db.query(IgnoredBill).all()}
    changes = {} if income else {row.key: row for row in db.query(BillChange).all()}
    items = []
    for key, txs in groups.items():
        found = _regular_run(txs, income)
        if found is None:
            continue
        cadence, run = found
        last = run[-1]
        reach = bank_reach.get(last.source, latest)
        amount, price_change = _price([_cents(t, income) for t in run])
        item = {
            "key": key,
            "name": _name(last.description),
            "category_name": last.category.name,
            "category_type": last.category.type.value,
            "cadence": cadence[0],
            "amount_cents": amount,
            "added": False,
            "found_amount_cents": amount,  # what the payments show, before a person's change
            "day": None,  # the day a person moved it to
            "last_date": last.date.isoformat(),
            "next_date": None,
            "state": None,
            "remaining": 0,
            "price_change": price_change,
            "history": [
                {"date": t.date.isoformat(), "amount_cents": _cents(t, income)}
                for t in reversed(run[-4:])
            ],
        }
        nxt = _step(last.date, cadence)
        change = changes.get(key)
        day = change.day if change is not None and cadence[2] else None
        if change is not None and change.amount is not None:
            item["amount_cents"] = money.to_cents(change.amount)
            item["price_change"] = None
        if day:
            item["day"] = day
            nxt = _moved_to(nxt, last.date, day)
        step = (lambda d: _months_on(d, cadence[2], day)) if day else (lambda d: _step(d, cadence))
        if key in ignored:
            item["state"] = "ignored"
            item["price_change"] = None
            items.append(item)
            continue
        if reach is not None and (reach - last.date).days > STOP_AFTER * cadence[1]:
            if (asof - last.date).days > 4 * cadence[1]:
                continue  # long gone: not worth a row
            item["state"] = "stopped"
            item["price_change"] = None
            items.append(item)
            continue
        item["next_date"] = nxt.isoformat()
        if nxt > end:
            item["state"] = "paid" if last.date >= start else "later"
        else:
            # Files that reach the date and show nothing: due. Files that stop short of it: expected.
            item["state"] = (
                "due" if reach is not None and nxt <= reach
                else "expected" if behind or nxt <= asof
                else "due"
            )
            remaining, when = 0, nxt
            while when <= end:
                remaining += 1
                when = step(when)
            item["remaining"] = remaining
        items.append(item)

    for bill in added:
        item = _added_item(bill, rows, start, end, asof, latest, behind)
        if item["key"] in ignored:
            item.update(state="ignored", remaining=0)
        items.append(item)

    items.sort(key=lambda i: (ORDER[i["state"]], i["next_date"] or "", i["last_date"] or "", i["name"]))
    unsettled = lambda state: sum(  # noqa: E731
        i["amount_cents"] * i["remaining"] for i in items if i["state"] == state
    )
    return {
        "month": f"{year}-{mo:02d}",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "today": today.isoformat(),
        "data_through": latest.isoformat() if latest else None,
        "status": "none" if not items else "gap" if behind else "ok",
        "due_cents": unsettled("due"),
        "expected_cents": unsettled("expected"),
        "items": items,
    }


def _pays(bill: AddedBill, tx: Transaction) -> bool:
    return tx.amount < 0 and bill.matches.lower() in tx.description.lower()


def _added_dates(bill: AddedBill, until: date) -> list[date]:
    """Every date an added bill is due, from its first up to `until`."""
    dates, k = [], 0
    while (d := _months_on(bill.starts, k * bill.every_months, bill.day)) <= until:
        dates.append(d)
        k += 1
    return dates


def _added_item(bill: AddedBill, rows: list[Transaction], start: date, end: date, asof: date,
                latest: date | None, behind: bool) -> dict:
    """A bill added by hand, as the scan shows a found one. A due date is settled by a confirmed outgoing
    payment whose description contains `matches`, within SETTLE_DAYS of it; each payment settles one date."""
    paid = [tx for tx in rows if tx.confirmed and _pays(bill, tx)]
    dates = _added_dates(bill, _add_months(max(end, bill.starts), bill.every_months + 1))
    unused = list(paid)
    unsettled = []
    for d in (d for d in dates if start <= d <= end):
        near = [tx for tx in unused if abs((tx.date - d).days) <= SETTLE_DAYS]
        if near:
            unused.remove(min(near, key=lambda tx: abs((tx.date - d).days)))
        else:
            unsettled.append(d)
    in_month = [d for d in dates if start <= d <= end]
    after = next((d for d in dates if d > end), None)
    category = bill.category
    item = {
        "key": f"{ADDED}{bill.id}",
        "name": _name(bill.name),
        "category_name": category.name if category else "No category",
        "category_type": category.type.value if category else "needs",
        "cadence": EVERY.get(bill.every_months, f"every {bill.every_months} months"),
        "amount_cents": money.to_cents(bill.amount),
        "added": True,
        "found_amount_cents": None,
        "day": bill.day,
        "every_months": bill.every_months,
        "starts": bill.starts.strftime("%Y-%m"),
        "matches": bill.matches,
        "last_date": paid[-1].date.isoformat() if paid else None,
        "next_date": after.isoformat() if after else None,
        "state": "later",
        "remaining": 0,
        "price_change": None,
        "history": [{"date": t.date.isoformat(), "amount_cents": _cents(t)} for t in reversed(paid[-4:])],
    }
    if unsettled:
        first = unsettled[0]
        item.update(
            next_date=first.isoformat(), remaining=len(unsettled),
            state=("due" if latest is not None and first <= latest
                   else "expected" if behind or first <= asof else "due"),
        )
    elif in_month:
        item["state"] = "paid"
    return item


def _first_on_day(day: int, today: date) -> date:
    """The first date on `day` from today on."""
    d = _on_day(today, day)
    return d if d >= today else _months_on(today, 1, day)


def _starts(value: str | None, day: int) -> date:
    if value is None:
        return _first_on_day(day, _today()).replace(day=1)
    try:
        return datetime.strptime(value, "%Y-%m").date()
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="The first month must be written as YYYY-MM")


def _check_bill(db: Session, fields: dict, bill_id: int | None = None) -> None:
    """Refuse what a bill cannot be, saying which field is wrong."""
    if "name" in fields:
        if not (fields["name"] or "").strip():
            raise HTTPException(status_code=422, detail="The bill's name is missing")
        same = db.query(AddedBill).filter(AddedBill.name == fields["name"].strip(), AddedBill.id != bill_id).first()
        if same is not None:
            raise HTTPException(status_code=422, detail=f"There is already an added bill called {same.name} ({ADDED}{same.id})")
    if "amount_cents" in fields and fields["amount_cents"] is not None and fields["amount_cents"] <= 0:
        raise HTTPException(status_code=422, detail="The amount must be more than zero cents")
    if "day" in fields and fields["day"] is not None and not 1 <= fields["day"] <= 31:
        raise HTTPException(status_code=422, detail="The day must be a day of the month, 1 to 31")
    if "every_months" in fields and not 1 <= (fields["every_months"] or 0) <= 12:
        raise HTTPException(status_code=422, detail="How often it comes must be every 1 to 12 months")
    if "matches" in fields and fields["matches"] is not None and len(fields["matches"].strip()) < MIN_MATCH:
        raise HTTPException(status_code=422, detail=f"The text to find its payments by needs at least {MIN_MATCH} characters")
    if fields.get("category_id") is not None:
        category = db.get(Category, fields["category_id"])
        if category is None:
            raise HTTPException(status_code=422, detail=f"Category {fields['category_id']} does not exist")
        if category.type.value not in BILL_TYPES:
            raise HTTPException(status_code=422, detail=(
                f"A fixed bill goes in a needs or wants category; {category.name} is a {category.type.value} category"))


class BillIn(BaseModel):
    name: str
    amount_cents: int
    day: int
    every_months: int = 1
    starts: str | None = None  # YYYY-MM, the calendar month of its first payment; default: the first such day from today
    matches: str | None = None  # text in its payments' bank description; default: the name
    category_id: int | None = None


class BillPatch(BaseModel):
    name: str | None = None
    amount_cents: int | None = None
    day: int | None = None
    every_months: int | None = None
    starts: str | None = None
    matches: str | None = None
    category_id: int | None = None


@router.post("/bills")
def add_bill(body: BillIn, db: Session = Depends(get_db)):
    """A fixed bill the app did not find in the payments, added by hand."""
    fields = body.model_dump()
    fields["matches"] = fields["matches"] if fields["matches"] is not None else fields["name"]
    _check_bill(db, fields)
    bill = AddedBill(
        name=body.name.strip(), amount=money.to_decimal(body.amount_cents), day=body.day,
        every_months=body.every_months, starts=_starts(body.starts, body.day),
        matches=fields["matches"].strip(), category_id=body.category_id,
    )
    db.add(bill)
    db.commit()
    return {"key": f"{ADDED}{bill.id}"}


def _added(db: Session, key: str) -> AddedBill:
    bill_id = key[len(ADDED):]
    bill = db.get(AddedBill, int(bill_id)) if bill_id.isdigit() else None
    if bill is None:
        raise HTTPException(status_code=404, detail=f"There is no added bill with the key '{key}'")
    return bill


@router.patch("/bills/{key}")
def update_bill(key: str, body: BillPatch, db: Session = Depends(get_db)):
    """Change a fixed bill: any field of one added by hand; the amount and/or day of one found from payments
    (null puts back what the payments show)."""
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    if not fields:
        raise HTTPException(status_code=422, detail="Say what changes: the amount, the day, or for an added bill also name, every_months, starts, matches or category_id")
    if key.startswith(ADDED):
        bill = _added(db, key)
        none = [k for k in ("name", "amount_cents", "day", "every_months", "starts", "matches") if k in fields and fields[k] is None]
        if none:
            raise HTTPException(status_code=422, detail=f"An added bill's {none[0]} cannot be left empty")
        _check_bill(db, fields, bill.id)
        if "name" in fields:
            bill.name = fields["name"].strip()
        if "amount_cents" in fields:
            bill.amount = money.to_decimal(fields["amount_cents"])
        if "day" in fields:
            bill.day = fields["day"]
        if "every_months" in fields:
            bill.every_months = fields["every_months"]
        if "starts" in fields:
            bill.starts = _starts(fields["starts"], bill.day)
        if "matches" in fields:
            bill.matches = fields["matches"].strip()
        if "category_id" in fields:
            bill.category_id = fields["category_id"]
        db.commit()
        return {"key": key}

    other = sorted(set(fields) - {"amount_cents", "day"})
    if other:
        raise HTTPException(status_code=422, detail=(
            f"Only the amount and the day of a fixed bill found from payments can be changed, not {', '.join(other)}"))
    _check_bill(db, fields)
    row = db.get(BillChange, key)
    found = next((i for i in _scan(None, db, income=False)["items"] if i["key"] == key and not i["added"]), None)
    if found is None and row is None:
        raise HTTPException(status_code=404, detail=f"There is no fixed bill with the key '{key}'")
    if found is not None and fields.get("day") is not None and found["cadence"] in ("weekly", "fortnightly"):
        raise HTTPException(status_code=422, detail=f"{found['name']} comes {found['cadence']}, so it has no day of the month to change")
    if row is None:
        row = BillChange(key=key)
        db.add(row)
    if "amount_cents" in fields:
        row.amount = None if fields["amount_cents"] is None else money.to_decimal(fields["amount_cents"])
    if "day" in fields:
        row.day = fields["day"]
    if row.amount is None and row.day is None:
        db.delete(row)
    db.commit()
    return {"key": key}


@router.delete("/bills/{key}")
def delete_bill(key: str, db: Session = Depends(get_db)):
    """Remove a bill added by hand. One found from payments is marked as not a fixed bill instead."""
    if not key.startswith(ADDED):
        raise HTTPException(status_code=422, detail=(
            "Only a bill added by hand can be deleted; one found from payments can be marked as not a fixed bill instead"))
    bill = _added(db, key)
    ignored = db.get(IgnoredBill, key)
    if ignored is not None:
        db.delete(ignored)
    db.delete(bill)
    db.commit()
    return {"deleted": key}


class BillKey(BaseModel):
    key: str


@router.post("/ignored")
def ignore_bill(body: BillKey, db: Session = Depends(get_db)):
    """A person says this repeating payment is not a fixed bill: it is no longer counted as still to pay."""
    key = body.key.strip()
    if not key:
        raise HTTPException(status_code=422, detail="Which payment?")
    if db.get(IgnoredBill, key) is None:
        db.add(IgnoredBill(key=key))
        db.commit()
    return {"ignored": key}


@router.delete("/ignored/{key}")
def count_bill_again(key: str, db: Session = Depends(get_db)):
    row = db.get(IgnoredBill, key)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"counted": key}
