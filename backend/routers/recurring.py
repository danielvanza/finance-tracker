"""Repeating payments found in the bank history: what is still to pay this financial month.

Read-only and derived on every call, nothing is stored. A payment counts as repeating once the same
description has come in at least three times on a regular day (weekly to yearly), always for a similar
amount. Only confirmed expenses count; refunds, splits, bills paid from a set-aside and exclude-type
categories are left out. A payment a person marked as not a fixed bill is listed apart and not counted.

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
from models import IgnoredBill, Transaction, TransactionSource

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


def _cadence_of(gap: int):
    """The cadence a gap in days belongs to, or None. Short cadences allow a narrower wobble."""
    best = min(CADENCES, key=lambda c: abs(gap - c[1]))
    return best if abs(gap - best[1]) <= min(4, round(best[1] * 0.15)) else None


def _regular_run(txs: list[Transaction]):
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
    cents = lambda t: -money.to_cents(t.amount)  # noqa: E731 - expenses are negative
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
    today = _today()
    year, mo = _parse_month(db, month, today)
    start, end = spend_service.financial_month_bounds(db, year, mo)
    asof = min(today, end)

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
        if (
            tx.amount >= 0 or tx.is_refund or tx.splits or tx.set_aside_id is not None
            or category is None or category.type.value not in ("needs", "wants", "savings")
        ):
            continue
        key = _key(tx.description)
        if key:
            groups.setdefault(key, []).append(tx)

    latest = max(bank_reach.values(), default=None)
    behind = latest is None or (asof - latest).days > BEHIND_DAYS

    ignored = {row.key for row in db.query(IgnoredBill).all()}
    items = []
    for key, txs in groups.items():
        found = _regular_run(txs)
        if found is None:
            continue
        cadence, run = found
        last = run[-1]
        reach = bank_reach.get(last.source, latest)
        amount, price_change = _price([-money.to_cents(t.amount) for t in run])
        item = {
            "key": key,
            "name": _name(last.description),
            "category_name": last.category.name,
            "category_type": last.category.type.value,
            "cadence": cadence[0],
            "amount_cents": amount,
            "last_date": last.date.isoformat(),
            "next_date": None,
            "state": None,
            "remaining": 0,
            "price_change": price_change,
            "history": [
                {"date": t.date.isoformat(), "amount_cents": -money.to_cents(t.amount)}
                for t in reversed(run[-4:])
            ],
        }
        nxt = _step(last.date, cadence)
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
                when = _step(when, cadence)
            item["remaining"] = remaining
        items.append(item)

    items.sort(key=lambda i: (ORDER[i["state"]], i["next_date"] or "", i["last_date"], i["name"]))
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
