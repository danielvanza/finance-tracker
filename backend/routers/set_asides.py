"""Set-asides: bills that do not come monthly. The sums are in set_asides.py."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

import money
import set_asides
import spend_service
from db import get_db
from models import SetAside, Transaction

router = APIRouter(prefix="/set-asides", tags=["set-asides"])

MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
MAX_CENTS = 99_999_999


class SetAsideIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    amount_cents: int = Field(gt=0, le=MAX_CENTS)
    due_month: str = Field(pattern=MONTH)
    yearly: bool = True


class SetAsidePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    amount_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    due_month: str | None = Field(default=None, pattern=MONTH)
    yearly: bool | None = None


class PaymentIn(BaseModel):
    transaction_id: int


def _first(index: int) -> date:
    return date(index // 12, index % 12 + 1, 1)


def _name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise HTTPException(422, "A set-aside needs a name")
    if len(name) > 60:
        raise HTTPException(422, "That name is too long; keep it under 60 characters")
    return name


def _bill(db: Session, bill_id: int) -> SetAside:
    bill = db.get(SetAside, bill_id)
    if bill is None:
        raise HTTPException(404, f"There is no set-aside with id {bill_id}")
    return bill


@router.get("")
def list_set_asides(month: str | None = Query(None, pattern=MONTH), db: Session = Depends(get_db)):
    return set_asides.month_view(db, month)


@router.post("", status_code=201)
def create_set_aside(body: SetAsideIn, db: Session = Depends(get_db)):
    now = set_asides.current_index(db)
    due = set_asides.label_index(body.due_month)
    if due < now:
        raise HTTPException(422, "The month a bill is due cannot be in the past")
    bill = SetAside(
        name=_name(body.name), amount=money.to_decimal(body.amount_cents), start_month=_first(now),
        due_month=_first(due), yearly=body.yearly,
    )
    db.add(bill)
    db.commit()
    return set_asides.month_view(db)


@router.patch("/{bill_id}")
def patch_set_aside(bill_id: int, body: SetAsidePatch, db: Session = Depends(get_db)):
    bill = _bill(db, bill_id)
    if body.name is not None:
        bill.name = _name(body.name)
    if body.amount_cents is not None:
        bill.amount = money.to_decimal(body.amount_cents)
    if body.yearly is not None:
        bill.yearly = body.yearly
    if body.due_month is not None:
        due = set_asides.label_index(body.due_month)
        if due < set_asides.month_index(bill.start_month):
            raise HTTPException(422, "The month a bill is due cannot be before setting aside for it began")
        bill.due_month = _first(due)
    db.commit()
    return set_asides.month_view(db)


@router.delete("/{bill_id}")
def delete_set_aside(bill_id: int, db: Session = Depends(get_db)):
    bill = _bill(db, bill_id)
    for tx in list(bill.payments):
        tx.set_aside_id = None  # the payment counts as ordinary spending again
    db.delete(bill)
    db.commit()
    return set_asides.month_view(db)


@router.post("/{bill_id}/payments")
def pay_from_set_aside(bill_id: int, body: PaymentIn, db: Session = Depends(get_db)):
    """Say that a payment is this bill. It then comes out of what was set aside and counts in no month."""
    bill = _bill(db, bill_id)
    tx = db.get(Transaction, body.transaction_id)
    if tx is None:
        raise HTTPException(422, f"There is no payment with id {body.transaction_id}")
    if tx.amount >= 0:
        raise HTTPException(422, "Only money going out can pay a bill")
    if tx.splits:
        raise HTTPException(422, "A split payment cannot pay a set-aside; remove the split first")
    tx.set_aside_id = bill.id
    db.flush()
    db.refresh(tx)
    rest = set_asides.uncovered_cents(tx, spend_service.get_start_day(db))
    if rest > 0 and tx.category_id is None:
        db.rollback()
        raise HTTPException(422, "Give that payment a category first: part of it was not set aside yet and counts as spending")
    tx.confirmed = True
    db.commit()
    return set_asides.month_view(db)


@router.delete("/{bill_id}/payments/{transaction_id}")
def unpay(bill_id: int, transaction_id: int, db: Session = Depends(get_db)):
    tx = db.get(Transaction, transaction_id)
    if tx is None or tx.set_aside_id != bill_id:
        raise HTTPException(404, "That payment is not linked to this set-aside")
    tx.set_aside_id = None
    db.commit()
    return set_asides.month_view(db)
