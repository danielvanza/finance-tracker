from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from decimal import Decimal
from datetime import date
from db import get_db
from models import Transaction, Budget, Category

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        from datetime import datetime
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    txs = db.query(Transaction).filter(
        extract("year", Transaction.date) == year,
        extract("month", Transaction.date) == mo,
        Transaction.confirmed == True,
    ).all()

    total_income = sum(t.amount for t in txs if t.amount > 0)
    total_expenses = abs(sum(t.amount for t in txs if t.amount < 0))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}
    budgets = {b.category_id: b.planned_amount
               for b in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all()}

    breakdown = {}
    for t in txs:
        if t.category_id and t.amount < 0:
            cid = t.category_id
            breakdown[cid] = breakdown.get(cid, Decimal("0")) + abs(t.amount)

    category_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "actual": float(actual), "planned": float(budgets.get(cid, Decimal("0"))),
         "type": cat_map[cid].type.value if hasattr(cat_map[cid].type, "value") else str(cat_map[cid].type)}
        for cid, actual in breakdown.items() if cid in cat_map
    ]

    savings_cats = {c.id for c in cats if c.type == "savings" or (hasattr(c.type, "value") and c.type.value == "savings")}
    total_savings = sum(
        abs(t.amount) for t in txs if t.category_id in savings_cats and t.amount < 0
    )
    needs_total = sum(d["actual"] for d in category_breakdown if d["type"] == "needs")
    wants_total = sum(d["actual"] for d in category_breakdown if d["type"] == "wants")

    # Last 6 months trend
    trend = []
    for i in range(5, -1, -1):
        m = mo - i
        y = year
        while m <= 0:
            m += 12; y -= 1
        month_txs = db.query(Transaction).filter(
            extract("year", Transaction.date) == y,
            extract("month", Transaction.date) == m,
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
        "needs_wants_savings": {
            "needs": float(needs_total),
            "wants": float(wants_total),
            "savings": float(total_savings),
        },
        "monthly_trend": trend,
    }
