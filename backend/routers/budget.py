from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import date, datetime
from decimal import Decimal
from collections import defaultdict
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
    try:
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")
    month_date = date(year, mo, 1)
    _auto_populate(month_date, db)

    # Single query to get all actual spend for the month
    actual_spend_rows = db.query(
        Transaction.category_id,
        func.sum(Transaction.amount).label("total")
    ).filter(
        extract("year", Transaction.date) == year,
        extract("month", Transaction.date) == mo,
        Transaction.confirmed == True,
        Transaction.amount < 0,
    ).group_by(Transaction.category_id).all()

    actual_by_cat = {row.category_id: abs(row.total) for row in actual_spend_rows}

    rows = db.query(Budget).filter(Budget.month == month_date).all()
    result = []
    for row in rows:
        actual = actual_by_cat.get(row.category_id, Decimal("0"))
        result.append({
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name,
            "month": row.month,
            "planned_amount": row.planned_amount,
            "actual_amount": actual,
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
