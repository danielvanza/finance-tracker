from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from decimal import Decimal
from datetime import date
from db import get_db
from models import Transaction, Budget, Category, Setting
from financial_month import get_financial_month_range

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        from datetime import datetime
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    start_day = _get_start_day(db)
    start_date, end_date = get_financial_month_range(year, mo, start_day)

    txs = db.query(Transaction).filter(
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.confirmed == True,
    ).all()

    total_income = sum(t.amount for t in txs if t.amount > 0)
    total_expenses = abs(sum(t.amount for t in txs if t.amount < 0))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}

    # Budget rows keyed by label month (1st of month)
    budgets = {b.category_id: b.planned_amount
               for b in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all()}

    # Expense breakdown (needs/wants/savings only)
    expense_breakdown = {}
    for t in txs:
        if t.category_id and t.amount < 0:
            cat = cat_map.get(t.category_id)
            if cat:
                cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
                if cat_type in ("needs", "wants", "savings"):
                    cid = t.category_id
                    expense_breakdown[cid] = expense_breakdown.get(cid, Decimal("0")) + abs(t.amount)

    category_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "actual": float(actual), "planned": float(budgets.get(cid, Decimal("0"))),
         "type": cat_map[cid].type.value if hasattr(cat_map[cid].type, "value") else str(cat_map[cid].type)}
        for cid, actual in expense_breakdown.items() if cid in cat_map
    ]

    # Income breakdown
    income_breakdown_map = {}
    for t in txs:
        if t.category_id and t.amount > 0:
            cat = cat_map.get(t.category_id)
            if cat:
                cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
                if cat_type == "income":
                    cid = t.category_id
                    income_breakdown_map[cid] = income_breakdown_map.get(cid, Decimal("0")) + t.amount

    income_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name, "amount": float(amount)}
        for cid, amount in income_breakdown_map.items() if cid in cat_map
    ]

    savings_cats = {c.id for c in cats
                    if (c.type.value if hasattr(c.type, "value") else str(c.type)) == "savings"}
    total_savings = sum(
        abs(t.amount) for t in txs if t.category_id in savings_cats and t.amount < 0
    )
    needs_total = sum(d["actual"] for d in category_breakdown if d["type"] == "needs")
    wants_total = sum(d["actual"] for d in category_breakdown if d["type"] == "wants")

    # Last 6 months trend using financial month ranges
    trend = []
    for i in range(5, -1, -1):
        m = mo - i
        y = year
        while m <= 0:
            m += 12
            y -= 1
        trend_start, trend_end = get_financial_month_range(y, m, start_day)
        month_txs = db.query(Transaction).filter(
            Transaction.date >= trend_start,
            Transaction.date <= trend_end,
            Transaction.confirmed == True,
            Transaction.amount < 0,
        ).all()
        trend.append({
            "month": f"{y}-{m:02d}",
            "total": float(abs(sum(t.amount for t in month_txs))),
        })

    return {
        "month": month,
        "total_income": float(total_income),
        "total_expenses": float(total_expenses),
        "total_savings": float(total_savings),
        "left_over": float(total_income - total_expenses),
        "category_breakdown": category_breakdown,
        "income_breakdown": income_breakdown,
        "needs_wants_savings": {
            "needs": float(needs_total),
            "wants": float(wants_total),
            "savings": float(total_savings),
        },
        "monthly_trend": trend,
    }
