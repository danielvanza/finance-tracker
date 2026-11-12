"""Set-asides: a bill that does not come monthly, spread over the months before it is due.

A bill has a name, an amount, the month it is due and how often it comes back (every 3 months, every
year, or once). From the month it was entered until the month it is due, an equal share is set aside
each month; a bill that comes back then starts again over its own number of months (three for a
quarterly bill, twelve for a yearly one).
The share lowers what is free to spend. The payment that settles the bill is linked to it and comes out
of what was set aside; only the part that had not been set aside yet counts as spending, in its month.
"""
from datetime import date

from sqlalchemy.orm import Session, selectinload

import clock
import money
import spend_service
from aggregate import effective_parts
from financial_month import label_month_for_date
from models import SetAside


def month_index(d: date) -> int:
    return d.year * 12 + d.month - 1


def index_label(index: int) -> str:
    return f"{index // 12}-{index % 12 + 1:02d}"


def label_index(label: str) -> int:
    year, month = label.split("-")
    return int(year) * 12 + int(month) - 1


def current_index(db: Session) -> int:
    year, month = label_month_for_date(clock.today(), spend_service.get_start_day(db))
    return year * 12 + month - 1


def _cycle(bill: SetAside, m: int) -> tuple[int, int] | None:
    """The months (first, last) over which the bill that month m saves for is collected."""
    start, due = month_index(bill.start_month), month_index(bill.due_month)
    if m < start:
        return None
    if m <= due:
        return start, due
    n = bill.every_months
    if not n:
        return None
    end = due + n * ((m - due + n - 1) // n)
    return end - n + 1, end


def _nearest_due(bill: SetAside, p: int) -> int:
    """The due month that a payment in month p settles. A bill may come a little early or late, so a
    payment belongs to the due month it is nearest to; one before the first due month settles that one."""
    due, n = month_index(bill.due_month), bill.every_months
    return max(due, due + n * round((p - due) / n)) if n else due


def _paid_in(bill: SetAside, cycle: tuple[int, int], start_day: int):
    """The linked payment that settles this cycle's bill, if there is one."""
    for tx in sorted(bill.payments, key=lambda t: t.date):
        paid = label_month_for_date(tx.date, start_day)
        p = paid[0] * 12 + paid[1] - 1
        if _nearest_due(bill, p) == cycle[1]:
            return tx, p
    return None


def _share(bill: SetAside, cycle: tuple[int, int], m: int) -> int:
    cents = money.to_cents(bill.amount)
    months = cycle[1] - cycle[0] + 1
    return cents // months + (cents % months if m == cycle[1] else 0)


def uncovered_cents(tx, start_day: int) -> int:
    """Of a payment that settles a set-aside: the part that had not been set aside yet when it was paid.

    That part counts as spending in the payment's month; the rest comes out of what was set aside. A bill
    of 600 paid when 100 had been set aside leaves 500 to count.
    """
    bill = tx.set_aside
    paid_cents = abs(money.to_cents(tx.amount))
    if bill is None:
        return paid_cents
    year, month = label_month_for_date(tx.date, start_day)
    p = year * 12 + month - 1
    end = _nearest_due(bill, p)
    cycle = _cycle(bill, end)
    saved = sum(_share(bill, cycle, i) for i in range(cycle[0], min(p, cycle[1]) + 1))
    return max(0, paid_cents - saved)


def counted_parts(tx, start_day: int) -> list:
    """A payment as the totals count it: its effective parts, or for one that settles a set-aside only
    the part that had not been set aside yet (in the payment's own category)."""
    if tx.set_aside_id is None:
        return effective_parts(tx)
    rest = uncovered_cents(tx, start_day)
    return [(tx.category_id, -money.to_decimal(rest), False)] if rest > 0 else []


def view(db: Session, bill: SetAside, m: int, start_day: int) -> dict:
    """One bill as month m sees it: this month's share, what is set aside so far, and its payment."""
    cycle = _cycle(bill, m)
    paid = _paid_in(bill, cycle, start_day) if cycle else None
    share = saved = 0
    if cycle:
        settled_before = paid is not None and paid[1] < m
        if not settled_before:
            share = _share(bill, cycle, m)
        if paid is None or paid[1] > m:
            saved = sum(_share(bill, cycle, i) for i in range(cycle[0], m + 1))
    payment = None
    if paid is not None:
        tx = paid[0]
        payment = {"transaction_id": tx.id, "date": tx.date.isoformat(), "description": tx.description,
                   "amount_cents": money.to_cents(tx.amount), "counted_cents": uncovered_cents(tx, start_day)}
    return {
        "id": bill.id, "name": bill.name, "amount_cents": money.to_cents(bill.amount),
        "start_month": index_label(month_index(bill.start_month)),
        "due_month": index_label(cycle[1] if cycle else month_index(bill.due_month)),
        "every_months": bill.every_months, "monthly_cents": share, "saved_cents": saved, "payment": payment,
        "over": cycle is None,
    }


def month_view(db: Session, label: str | None = None) -> dict:
    m = label_index(label) if label else current_index(db)
    start_day = spend_service.get_start_day(db)
    bills = db.query(SetAside).options(selectinload(SetAside.payments)).order_by(SetAside.due_month, SetAside.id).all()
    items = [view(db, bill, m, start_day) for bill in bills]
    return {"month": index_label(m), "items": items, "set_aside_cents": sum(i["monthly_cents"] for i in items)}
