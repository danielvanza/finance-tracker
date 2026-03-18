from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, datetime
from typing import Optional
from db import get_db
from models import Transaction, Category, Rule, Setting
from schemas import TransactionPatch
from financial_month import get_financial_month_range

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


def _to_out(tx: Transaction) -> dict:
    return {
        "id": tx.id, "date": tx.date, "amount": tx.amount,
        "description": tx.description, "source": tx.source,
        "category_id": tx.category_id,
        "category_name": tx.category.name if tx.category else None,
        "confirmed": tx.confirmed,
        "categorised_by": tx.categorised_by,
        "ai_confidence": tx.ai_confidence,
    }


@router.get("")
def list_transactions(
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    source: Optional[str] = None,
    confirmed: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction)
    if month:
        try:
            parsed = datetime.strptime(month, "%Y-%m")
            year, mo = parsed.year, parsed.month
        except ValueError:
            raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")
        start_day = _get_start_day(db)
        start_date, end_date = get_financial_month_range(year, mo, start_day)
        q = q.filter(Transaction.date >= start_date, Transaction.date <= end_date)
    if category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
    if source:
        q = q.filter(Transaction.source == source)
    if confirmed is not None:
        q = q.filter(Transaction.confirmed == confirmed)
    # Unconfirmed first
    q = q.order_by(Transaction.confirmed.asc(), Transaction.date.desc())
    return [_to_out(tx) for tx in q.all()]


@router.get("/review")
def next_review(db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.confirmed == False).order_by(Transaction.date.asc()).first()
    if not tx:
        return None
    return _to_out(tx)


@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, body: TransactionPatch, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404)
    if body.category_id is not None:
        tx.category_id = body.category_id
        if tx.categorised_by == "ai":
            tx.categorised_by = "manual"
    if body.confirmed is not None:
        tx.confirmed = body.confirmed
    db.commit()
    db.refresh(tx)
    return _to_out(tx)


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
            # Check sign compatibility
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
