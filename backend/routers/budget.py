from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from decimal import Decimal
from db import get_db
from models import Budget, Category, Transaction
from schemas import BudgetPatch
from sqlalchemy import extract, func

router = APIRouter(prefix="/budget", tags=["budget"])

def _auto_populate(month_date: date, db: Session):
    """Create budget rows for month from defaults if they don't exist."""
    defaults = db.query(Budget).filter(Budget.month == None).all()
    for d in defaults:
        exists = db.query(Budget).filter_by(category_id=d.category_id, month=month_date).first()
        if not exists:
            db.add(Budget(category_id=d.category_id, month=month_date, planned_amount=d.planned_amount))
    db.commit()

@router.get("")
def get_budget(month: str = Query(...), db: Session = Depends(get_db)):
    year, mo = int(month[:4]), int(month[5:7])
    month_date = date(year, mo, 1)
    _auto_populate(month_date, db)
    rows = db.query(Budget).filter(Budget.month == month_date).all()
    result = []
    for row in rows:
        actual = db.query(func.sum(Transaction.amount)).filter(
            Transaction.category_id == row.category_id,
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == mo,
            Transaction.confirmed == True,
        ).scalar() or Decimal("0")
        result.append({
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name,
            "month": row.month,
            "planned_amount": row.planned_amount,
            "actual_amount": abs(actual) if actual < 0 else actual,
        })
    return result

@router.patch("/defaults/{category_id}")
def patch_default(category_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.query(Budget).filter_by(category_id=category_id, month=None).first()
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    return {"category_id": category_id, "planned_amount": row.planned_amount}

@router.patch("/{budget_id}")
def patch_budget(budget_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.get(Budget, budget_id)
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    db.refresh(row)
    return {"id": row.id, "planned_amount": row.planned_amount,
            "category_name": row.category.name, "month": row.month}
