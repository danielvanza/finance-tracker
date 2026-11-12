"""A set-aside's bill comes back every so many months: the shares, the due month, what a payment settles."""
from datetime import date
from decimal import Decimal

import set_asides
from models import SetAside, Transaction, TransactionSource

START_DAY = 1


def _bill(db, every_months, amount="300.00"):
    bill = SetAside(name="Car tax", amount=Decimal(amount), start_month=date(2026, 11, 1),
                    due_month=date(2027, 1, 1), every_months=every_months)
    db.add(bill)
    db.commit()
    return bill


def _month(db, bill, label):
    return set_asides.view(db, bill, set_asides.label_index(label), START_DAY)


def _pay(db, bill, day, amount="-300.00"):
    tx = Transaction(date=day, amount=Decimal(amount), description="Belastingdienst", source=TransactionSource.ing,
                     confirmed=True, import_hash=f"h{day}", set_aside_id=bill.id)
    db.add(tx)
    db.commit()
    db.refresh(bill)
    return tx


def test_quarterly_bill_starts_again_over_three_months(db):
    bill = _bill(db, 3)
    assert _month(db, bill, "2026-11")["monthly_cents"] == 10000
    later = _month(db, bill, "2027-02")
    assert later["due_month"] == "2027-04"
    assert (later["monthly_cents"], later["saved_cents"]) == (10000, 10000)
    assert _month(db, bill, "2027-04")["saved_cents"] == 30000
    assert _month(db, bill, "2027-05")["due_month"] == "2027-07"


def test_yearly_bill_starts_again_over_twelve_months(db):
    bill = _bill(db, 12, "1200.00")
    assert _month(db, bill, "2026-11")["monthly_cents"] == 40000
    later = _month(db, bill, "2027-02")
    assert (later["due_month"], later["monthly_cents"]) == ("2028-01", 10000)


def test_one_off_bill_is_over_after_its_month(db):
    bill = _bill(db, None)
    assert _month(db, bill, "2027-01")["over"] is False
    assert _month(db, bill, "2027-02")["over"] is True


def test_quarterly_payment_settles_the_nearest_due_month(db):
    bill = _bill(db, 3)
    early = _pay(db, bill, date(2027, 3, 20))  # a month before April's bill: 200 of 300 set aside
    assert set_asides.uncovered_cents(early, START_DAY) == 10000
    view = _month(db, bill, "2027-04")
    assert view["payment"]["transaction_id"] == early.id
    assert view["monthly_cents"] == 0  # settled the month before


def test_payment_before_the_first_due_month_settles_that_one(db):
    bill = _bill(db, 3)
    tx = _pay(db, bill, date(2026, 11, 5))  # only November's 100 set aside
    assert set_asides.uncovered_cents(tx, START_DAY) == 20000
    assert _month(db, bill, "2027-01")["payment"]["transaction_id"] == tx.id
