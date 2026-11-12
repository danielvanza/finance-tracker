from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import uuid4
from db import get_db
from models import Transaction, TransactionSplit, TransactionSource, Category
from schemas import TransactionPatch, TransactionCreate, SplitIn, TransactionOut, SplitOut
import guesses
import spend_service
from importers.base import make_hash

router = APIRouter(prefix="/transactions", tags=["transactions"])

EXPENSE_TYPES = ("needs", "wants", "savings")


class SplitPartIn(SplitIn):
    """v2: optional per-part refund flag. Router-local extension — branch B2
    may not edit schemas.py. None -> DB NULL -> part inherits parent flag."""
    is_refund: Optional[bool] = None


class TransactionPatchV2(TransactionPatch):
    splits: Optional[list[SplitPartIn]] = None
    remember: bool = False  # also make this payment's category the rule for its shop


def _cat_type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


def _to_out(tx: Transaction) -> dict:
    return TransactionOut(
        id=tx.id, date=tx.date, amount=tx.amount, description=tx.description,
        source=tx.source.value if hasattr(tx.source, "value") else str(tx.source),
        category_id=tx.category_id,
        category_name=tx.category.name if tx.category else None,
        confirmed=tx.confirmed,
        categorised_by=(tx.categorised_by.value if hasattr(tx.categorised_by, "value")
                        else str(tx.categorised_by)) if tx.categorised_by else None,
        ai_confidence=tx.ai_confidence, is_refund=tx.is_refund,
        set_aside_id=tx.set_aside_id, set_aside_name=tx.set_aside.name if tx.set_aside else None,
        splits=[SplitOut(
            id=s.id, category_id=s.category_id,
            category_name=s.category.name if s.category else None,
            amount=s.amount,
            is_refund=(tx.is_refund if s.is_refund is None else s.is_refund),
        ) for s in tx.splits],
    ).model_dump(by_alias=True)


def _require_category(category_id: int, db: Session) -> Category:
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=422, detail=f"Category {category_id} does not exist")
    return cat


def _validate_refund(amount: Decimal, categories: list[Category]):
    if amount <= 0:
        raise HTTPException(status_code=422,
                            detail="Only an incoming (positive) amount can be marked as a refund")
    for cat in categories:
        if _cat_type(cat) not in EXPENSE_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"A refund must reduce an expense category (needs/wants/savings), "
                       f"but '{cat.name}' is {_cat_type(cat)}",
            )


def _apply_splits(tx: Transaction, splits: list[SplitPartIn], db: Session):
    if len(splits) == 0:
        tx.splits = []
        return
    if len(splits) == 1:
        raise HTTPException(status_code=422,
                            detail="A split needs at least two parts; set category_id instead")
    total = sum(s.amount for s in splits)
    if total != tx.amount:
        raise HTTPException(
            status_code=422,
            detail=f"Split parts must sum to the transaction amount ({tx.amount}), got {total}",
        )
    for s in splits:
        if s.amount == 0:
            raise HTTPException(status_code=422, detail="Split parts must have a non-zero amount")
        if (tx.amount > 0) != (s.amount > 0):
            raise HTTPException(status_code=422,
                                detail="Split parts must share the transaction's sign")
        _require_category(s.category_id, db)
        if s.is_refund:
            part_cat = _require_category(s.category_id, db)
            if _cat_type(part_cat) not in EXPENSE_TYPES:
                raise HTTPException(status_code=422, detail=(
                    f"A refund part must reduce an expense category (needs/wants/savings), "
                    f"but '{part_cat.name}' is {_cat_type(part_cat)}"))
    tx.splits = [TransactionSplit(category_id=s.category_id, amount=s.amount,
                                  is_refund=s.is_refund) for s in splits]
    tx.category_id = None


@router.get("")
def list_transactions(
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    source: Optional[str] = None,
    confirmed: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction).options(selectinload(Transaction.splits))
    if month:
        try:
            parsed = datetime.strptime(month, "%Y-%m")
            year, mo = parsed.year, parsed.month
        except ValueError:
            raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")
        start_date, end_date = spend_service.financial_month_bounds(db, year, mo)
        q = q.filter(Transaction.date >= start_date, Transaction.date <= end_date)
    if category_id is not None:
        q = q.filter(or_(
            Transaction.category_id == category_id,
            Transaction.splits.any(TransactionSplit.category_id == category_id),
        ))
    if source:
        q = q.filter(Transaction.source == source)
    if confirmed is not None:
        q = q.filter(Transaction.confirmed == confirmed)
    # Unconfirmed first
    q = q.order_by(Transaction.confirmed.asc(), Transaction.date.desc())
    return [_to_out(tx) for tx in q.all()]


@router.get("/review")
def next_review(skip_ids: list[int] = Query(default=[]), db: Session = Depends(get_db)):
    q = db.query(Transaction).filter(Transaction.confirmed == False)
    if skip_ids:
        q = q.filter(~Transaction.id.in_(skip_ids))
    tx = q.order_by(Transaction.date.asc()).first()
    if not tx:
        return None
    return _to_out(tx)


@router.post("", status_code=201)
def create_transaction(body: TransactionCreate, db: Session = Depends(get_db)):
    """Create a manual transaction (not from a CSV). Auto-confirmed: the user
    just picked the category themselves."""
    if body.amount == 0:
        raise HTTPException(status_code=422, detail="Amount must be non-zero")
    cat = _require_category(body.category_id, db)
    if body.is_refund:
        _validate_refund(body.amount, [cat])
    tx = Transaction(
        date=body.date, amount=body.amount, description=body.description,
        source=TransactionSource.manual, category_id=body.category_id,
        confirmed=True, categorised_by="manual", is_refund=body.is_refund,
        import_hash=make_hash("manual", body.date, body.amount, body.description, uuid4().hex),
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return _to_out(tx)


@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, body: TransactionPatchV2, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404)
    was_waiting = not tx.confirmed
    was_guess = tx.categorised_by == "ai"
    if body.category_id is not None:
        _require_category(body.category_id, db)
        tx.category_id = body.category_id
        if tx.categorised_by in ("ai", "rule", None):
            tx.categorised_by = "manual"
    if body.is_refund is not None:
        tx.is_refund = body.is_refund
    if body.confirmed is not None:
        if body.confirmed and tx.category_id is None and not tx.splits and body.splits is None and tx.set_aside_id is None:
            raise HTTPException(status_code=422, detail="Pick a category before confirming, or it would count nowhere")
        tx.confirmed = body.confirmed
        if body.confirmed and was_waiting and tx.categorised_by in ("ai", None):
            tx.categorised_by = "manual"  # a person looked at it; "ai" on a counted row means sorted automatically
    if body.splits is not None:
        _apply_splits(tx, body.splits, db)
    if tx.is_refund:
        cat_ids = [s.category_id for s in tx.splits] if tx.splits else [tx.category_id]
        categories = [db.get(Category, cid) for cid in cat_ids if cid is not None]
        _validate_refund(tx.amount, [c for c in categories if c])
    # A person answering for a waiting payment, or putting right one the app sorted by itself, settles
    # that shop's other waiting payments. Later ones only follow when the person asks to remember it.
    answered = tx.confirmed and (was_waiting or (was_guess and body.category_id is not None))
    if answered and tx.category_id is not None and not tx.splits and not tx.is_refund:
        db.flush()
        db.refresh(tx)
        guesses.settle_like(db, tx)
        if body.remember:
            guesses.remember(db, tx)
    db.commit()
    db.refresh(tx)
    return _to_out(tx)


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404)
    source = tx.source.value if hasattr(tx.source, "value") else str(tx.source)
    if source != "manual":
        raise HTTPException(status_code=422,
                            detail="Only manual transactions can be deleted; imported rows are immutable")
    db.delete(tx)
    db.commit()
    return {"deleted": tx_id}
