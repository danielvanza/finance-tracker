from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from db import get_db
from models import Transaction, Category, Rule
from schemas import TransactionPatch

router = APIRouter(prefix="/transactions", tags=["transactions"])

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
        from datetime import date
        year, mo = int(month[:4]), int(month[5:7])
        from sqlalchemy import extract
        q = q.filter(extract("year", Transaction.date) == year,
                     extract("month", Transaction.date) == mo)
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
    tx = db.query(Transaction).filter(Transaction.confirmed == False).first()
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
    and retroactively confirm all matching unconfirmed transactions."""
    tx = db.get(Transaction, tx_id)
    if not tx or not tx.category_id:
        raise HTTPException(400, "Transaction must have a category before creating a rule")
    pattern = tx.description.lower().strip()
    rule = Rule(pattern=pattern, category_id=tx.category_id, priority=0)
    db.add(rule)
    # Retroactively confirm matching unconfirmed transactions
    unconfirmed = db.query(Transaction).filter(Transaction.confirmed == False).all()
    updated = 0
    for t in unconfirmed:
        if pattern in t.description.lower():
            t.confirmed = True
            t.category_id = tx.category_id
            t.categorised_by = "rule"
            updated += 1
    db.commit()
    return {"rule_created": pattern, "transactions_updated": updated}
