from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from datetime import date, datetime
from db import get_db
from models import Budget, Category
import money
import spend_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

EXPENSE_TYPES = ("needs", "wants", "savings")


def _cat_type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    start_date, end_date = spend_service.financial_month_bounds(
        db, year, mo, materialise=True)
    parts = spend_service.confirmed_parts_in_range(db, start_date, end_date)

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}
    exclude_cat_ids = {c.id for c in cats if _cat_type(c) == "exclude"}

    # Spend contribution is -amount, so refund parts net against expenses
    spend_totals = spend_service.spend_totals_by_category(parts, exclude_cat_ids)
    total_expenses = sum(spend_totals.values())
    income_totals = spend_service.income_totals_by_category(parts, exclude_cat_ids)
    total_income = sum(income_totals.values())

    # Budget rows keyed by label month (1st of month)
    budgets = {b.category_id: b.planned_amount
               for b in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all()}

    # Expense breakdown (needs/wants/savings only), refunds netted per category
    expense_breakdown = {
        cid: actual for cid, actual in spend_totals.items()
        if cid in cat_map and _cat_type(cat_map[cid]) in EXPENSE_TYPES
    }

    category_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "actual_cents": money.to_cents(actual),
         "planned_cents": money.to_cents(budgets.get(cid, Decimal("0"))),
         "type": _cat_type(cat_map[cid])}
        for cid, actual in expense_breakdown.items()
    ]

    # Income breakdown
    income_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "amount_cents": money.to_cents(amount)}
        for cid, amount in income_totals.items()
        if cid in cat_map and _cat_type(cat_map[cid]) == "income"
    ]

    savings_cat_ids = {cid for cid, c in cat_map.items() if _cat_type(c) == "savings"}
    total_savings = sum(v for cid, v in spend_totals.items() if cid in savings_cat_ids)
    needs_total = sum(v for cid, v in expense_breakdown.items()
                      if _cat_type(cat_map[cid]) == "needs")
    wants_total = sum(v for cid, v in expense_breakdown.items()
                      if _cat_type(cat_map[cid]) == "wants")

    # Last 6 months trend using financial month ranges
    trend = []
    for i in range(5, -1, -1):
        m = mo - i
        y = year
        while m <= 0:
            m += 12
            y -= 1
        trend_start, trend_end = spend_service.financial_month_bounds(db, y, m)
        trend_parts = spend_service.confirmed_parts_in_range(db, trend_start, trend_end)
        trend_totals = spend_service.spend_totals_by_category(trend_parts, exclude_cat_ids)
        trend.append({
            "month": f"{y}-{m:02d}",
            "total_cents": money.to_cents(sum(trend_totals.values())),
        })

    left_over = total_income - total_expenses
    return {
        "month": month,
        "total_income_cents": money.to_cents(total_income),
        "total_expenses_cents": money.to_cents(total_expenses),
        "total_savings_cents": money.to_cents(total_savings),
        "left_over_cents": money.to_cents(left_over),
        "category_breakdown": category_breakdown,
        "income_breakdown": income_breakdown,
        "needs_wants_savings": {
            "needs_cents": money.to_cents(needs_total),
            "wants_cents": money.to_cents(wants_total),
            "savings_cents": money.to_cents(total_savings),
        },
        "monthly_trend": trend,
    }
