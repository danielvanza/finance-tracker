from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from datetime import date, datetime
from decimal import Decimal
from db import get_db
from models import Budget, Category
from schemas import BudgetPatch
import money
import spend_service

router = APIRouter(prefix="/budget", tags=["budget"])

BUDGETED = ("needs", "wants", "savings")


def planned_for(db: Session, month_date: date) -> dict[int, Decimal]:
    """Each budgeted category's planned amount in a month: what was last set at or before it.

    A plan stays as it is until it is changed, so a month takes the newest earlier month's amount. A month
    from before any was set takes the starting amount (the row with no month).
    """
    planned: dict[int, Decimal] = {}
    newest: dict[int, date] = {}
    starting: dict[int, Decimal] = {}
    for row in db.query(Budget).all():
        if row.month is None:
            starting[row.category_id] = row.planned_amount
        elif row.month <= month_date and row.month >= newest.get(row.category_id, date.min):
            newest[row.category_id] = row.month
            planned[row.category_id] = row.planned_amount
    return {
        c.id: planned.get(c.id, starting.get(c.id, Decimal("0")))
        for c in db.query(Category).all()
        if (c.type.value if hasattr(c.type, "value") else str(c.type)) in BUDGETED
    }


def _auto_populate(month_date: date, db: Session):
    """Give the month its own budget rows, each carrying forward what was last planned."""
    for category_id, amount in planned_for(db, month_date).items():
        # Two requests can fill the same new month at once: the second one simply adds nothing.
        db.execute(
            insert(Budget)
            .values(category_id=category_id, month=month_date, planned_amount=amount)
            .on_conflict_do_nothing(index_elements=["category_id", "month"])
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

    start_date, end_date = spend_service.financial_month_bounds(db, year, mo)

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
        if cat_type not in BUDGETED:
            continue
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


@router.patch("/{budget_id}")
def patch_budget(budget_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    """Change a category's plan from this row's month on, until the month it was changed again: later
    months that still hold the old amount follow, up to the first one that holds another. Earlier months
    keep what they had."""
    row = db.get(Budget, budget_id)
    if not row or row.month is None:
        raise HTTPException(404)
    if body.planned_amount < 0:
        raise HTTPException(status_code=422, detail="A planned amount cannot be negative")
    was = row.planned_amount
    row.planned_amount = body.planned_amount
    later = (
        db.query(Budget).filter(Budget.category_id == row.category_id, Budget.month > row.month)
        .order_by(Budget.month).all()
    )
    changed = 1
    for other in later:
        if other.planned_amount != was:
            break  # changed again in that month: it and what follows keep their own
        other.planned_amount = body.planned_amount
        changed += 1
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "planned_amount_cents": money.to_cents(row.planned_amount),
        "category_name": row.category.name,
        "month": row.month,
        "months_changed": changed,
    }
