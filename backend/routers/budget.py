from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, selectinload
from datetime import date, datetime
from decimal import Decimal
from db import get_db
from models import Budget, Category, Transaction, Setting
from schemas import BudgetPatch
from financial_month import get_financial_month_range
from aggregate import effective_parts, is_spend_part
from adjustments import materialise_standing_adjustments

router = APIRouter(prefix="/budget", tags=["budget"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


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

    start_day = _get_start_day(db)
    materialise_standing_adjustments(year, mo, start_day, db)
    start_date, end_date = get_financial_month_range(year, mo, start_day)

    # Actual spend for the financial month: expenses netted with refunds,
    # split transactions counted per part. May go below zero when a category
    # is refunded more than it was spent this month.
    income_cat_ids = {
        c.id
        for c in db.query(Category).all()
        if (c.type.value if hasattr(c.type, "value") else str(c.type))
        in ("income", "exclude")
    }

    txs = db.query(Transaction).options(selectinload(Transaction.splits)).filter(
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.confirmed == True,
    ).all()

    actual_by_cat: dict[int, Decimal] = {}
    for tx in txs:
        for cid, amount, refund in effective_parts(tx):
            if cid is None or cid in income_cat_ids:
                continue
            if is_spend_part(amount, refund):
                actual_by_cat[cid] = actual_by_cat.get(cid, Decimal("0")) - amount

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
                "planned_amount": row.planned_amount,
                "actual_amount": actual,
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
    return {"category_id": category_id, "planned_amount": row.planned_amount}


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
        "planned_amount": row.planned_amount,
        "category_name": row.category.name,
        "month": row.month,
    }
