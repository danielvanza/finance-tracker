from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import uuid4
from db import get_db
from models import Transaction, TransactionSplit, TransactionSource, Category, Rule
from schemas import (TransactionPatch, TransactionCreate, AdjustmentPairCreate,
                     SplitIn, TransactionOut, SplitOut)
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
        standing_adjustment_id=tx.standing_adjustment_id,
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
        start_date, end_date = spend_service.financial_month_bounds(
            db, year, mo, materialise=True)
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


@router.post("/adjustment-pair", status_code=201)
def create_adjustment_pair(body: AdjustmentPairCreate, db: Session = Depends(get_db)):
    """Create a balanced pair of manual transactions. The two legs must net to
    exactly zero so the pair can never change left_over."""
    if len(body.legs) != 2:
        raise HTTPException(status_code=422, detail="An adjustment pair needs exactly two legs")
    total = sum(leg.amount for leg in body.legs)
    if total != 0:
        raise HTTPException(status_code=422,
                            detail=f"Adjustment legs must net to zero, got {total}")
    if any(leg.amount == 0 for leg in body.legs):
        raise HTTPException(status_code=422, detail="Adjustment legs must have a non-zero amount")
    for leg in body.legs:
        _require_category(leg.category_id, db)
    txs = []
    for leg in body.legs:
        tx = Transaction(
            date=body.date, amount=leg.amount,
            description=leg.description or body.description,
            source=TransactionSource.manual, category_id=leg.category_id,
            confirmed=True, categorised_by="manual",
            import_hash=make_hash("manual", body.date, leg.amount,
                                  leg.description or body.description, uuid4().hex),
        )
        db.add(tx)
        txs.append(tx)
    db.commit()
    for tx in txs:
        db.refresh(tx)
    return [_to_out(tx) for tx in txs]


@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, body: TransactionPatchV2, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404)
    if body.category_id is not None:
        _require_category(body.category_id, db)
        tx.category_id = body.category_id
        if tx.categorised_by == "ai":
            tx.categorised_by = "manual"
    if body.is_refund is not None:
        tx.is_refund = body.is_refund
    if body.confirmed is not None:
        tx.confirmed = body.confirmed
    if body.splits is not None:
        _apply_splits(tx, body.splits, db)
    if tx.is_refund:
        cat_ids = [s.category_id for s in tx.splits] if tx.splits else [tx.category_id]
        categories = [db.get(Category, cid) for cid in cat_ids if cid is not None]
        _validate_refund(tx.amount, [c for c in categories if c])
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


@router.post("/{tx_id}/create-rule")
def create_rule_from_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Create a rule from this transaction's description, confirm current tx,
    and retroactively confirm all matching unconfirmed transactions
    whose sign is compatible with the rule's target category."""
    tx = db.get(Transaction, tx_id)
    if not tx or not tx.category_id:
        raise HTTPException(400, "Transaction must have a category before creating a rule")

    category = db.get(Category, tx.category_id)
    cat_type = category.type.value if hasattr(category.type, "value") else str(category.type)

    pattern = tx.description.lower().strip()
    existing_rule = db.query(Rule).filter_by(pattern=pattern).first()
    if not existing_rule:
        rule = Rule(pattern=pattern, category_id=tx.category_id, priority=0)
        db.add(rule)

    # Retroactively confirm matching unconfirmed transactions (sign-aware)
    unconfirmed = db.query(Transaction).filter(Transaction.confirmed == False).all()
    updated = 0
    for t in unconfirmed:
        if pattern in t.description.lower():
            # Refund-marked or split transactions carry user decisions a rule
            # must not overwrite
            if t.is_refund or t.splits:
                continue
            # Check sign compatibility (exclude is allowed for any sign)
            if cat_type != "exclude":
                if t.amount > 0 and cat_type != "income":
                    continue
                if t.amount <= 0 and cat_type == "income":
                    continue
            t.confirmed = True
            t.category_id = tx.category_id
            t.categorised_by = "rule"
            updated += 1
    db.commit()
    return {"rule_created": pattern, "transactions_updated": updated}
