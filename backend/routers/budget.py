from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import date, datetime
from decimal import Decimal
from db import get_db
from models import Budget, Category
from schemas import BudgetPatch
import money
import spend_service

router = APIRouter(prefix="/budget", tags=["budget"])


def _auto_populate(month_date: date, db: Session):
    """Create budget rows for month from defaults if they don't exist.
    Skips income categories — they have no budget."""
    defaults = db.query(Budget).filter(Budget.month == None).all()
    for d in defaults:
        cat = db.get(Category, d.category_id)
        cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
        if cat_type in ("income", "exclude"):
            continue
        exists = (
            db.query(Budget)
            .filter_by(category_id=d.category_id, month=month_date)
            .first()
        )
        if not exists:
            db.add(
                Budget(
                    category_id=d.category_id,
                    month=month_date,
                    planned_amount=d.planned_amount,
                )
            )
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

    start_date, end_date = spend_service.financial_month_bounds(
        db, year, mo, materialise=True)

    # Actual spend for the financial month: expenses netted with refunds,
    # split transactions counted per part. May go below zero when a category
    # is refunded more than it was spent this month.
    skip_cat_ids = {
        c.id
        for c in db.query(Category).all()
        if (c.type.value if hasattr(c.type, "value") else str(c.type))
        in ("income", "exclude")
    }

    parts = spend_service.confirmed_parts_in_range(db, start_date, end_date)
    actual_by_cat = spend_service.spend_totals_by_category(parts, skip_cat_ids)

    rows = db.query(Budget).filter(Budget.month == month_date).all()
    result = []
    for row in rows:
        actual = actual_by_cat.get(row.category_id, Decimal("0"))
        cat = row.category
        cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
        result.append(
            {
                "id": row.id,
                "category_id": row.category_id,
                "category_name": cat.name,
                "category_type": cat_type,
                "month": row.month,
                "planned_amount_cents": money.to_cents(row.planned_amount),
                "actual_amount_cents": money.to_cents(actual),
            }
        )
    return result


@router.patch("/defaults/{category_id}")
def patch_default(category_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.query(Budget).filter_by(category_id=category_id, month=None).first()
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    return {"category_id": category_id,
            "planned_amount_cents": money.to_cents(row.planned_amount)}


@router.patch("/{budget_id}")
def patch_budget(budget_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.get(Budget, budget_id)
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "planned_amount_cents": money.to_cents(row.planned_amount),
        "category_name": row.category.name,
        "month": row.month,
    }
