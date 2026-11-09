from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload
from decimal import Decimal
from datetime import date, datetime, timedelta
from aggregate import effective_parts, is_spend_part, spend_contribution
from db import get_db
from financial_month import label_month_for_date
from models import Budget, Category, Transaction, TransactionSource
from routers.budget import _auto_populate
import money
import spend_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

EXPENSE_TYPES = ("needs", "wants", "savings")
SPENDABLE_TYPES = ("needs", "wants")
BANK_SOURCES = (TransactionSource.ing, TransactionSource.revolut, TransactionSource.degiro)


def _today() -> date:
    return date.today()


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


@router.get("/pace")
def pace(month: str | None = Query(None), db: Session = Depends(get_db)):
    """Spending against plan across one financial month (default: the current one).

    Spendable means needs + wants; savings are reported but are not "left to
    spend". Only confirmed transactions count, as everywhere else. A month with
    no bank transactions has no answer yet, whatever manual entries it holds.
    """
    start_day = spend_service.get_start_day(db)
    today = _today()
    current_label = label_month_for_date(today, start_day)
    if month is None:
        year, mo = current_label
    else:
        try:
            parsed = datetime.strptime(month, "%Y-%m")
            year, mo = parsed.year, parsed.month
        except ValueError:
            raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    month_date = date(year, mo, 1)
    _auto_populate(month_date, db)
    start, end = spend_service.financial_month_bounds(db, year, mo, materialise=True)
    types = {c.id: _cat_type(c) for c in db.query(Category).all()}

    plan = {kind: Decimal("0") for kind in EXPENSE_TYPES}
    for row in db.query(Budget).filter(Budget.month == month_date).all():
        kind = types.get(row.category_id)
        if kind in plan:
            plan[kind] += row.planned_amount

    confirmed = db.query(Transaction).options(selectinload(Transaction.splits)).filter(
        Transaction.date >= start,
        Transaction.date <= end,
        Transaction.confirmed == True,  # noqa: E712 - historic form
    ).all()
    actual = {kind: Decimal("0") for kind in EXPENSE_TYPES}
    spent_on: dict[date, Decimal] = {}
    for tx in confirmed:
        for category_id, amount, is_refund in effective_parts(tx):
            kind = types.get(category_id)
            if kind not in EXPENSE_TYPES or not is_spend_part(amount, is_refund):
                continue
            contribution = spend_contribution(amount, is_refund)
            actual[kind] += contribution
            if kind in SPENDABLE_TYPES:
                spent_on[tx.date] = spent_on.get(tx.date, Decimal("0")) + contribution

    from_bank = db.query(Transaction).filter(Transaction.source.in_(BANK_SOURCES))
    data_through = from_bank.filter(
        Transaction.date >= start, Transaction.date <= end,
    ).with_entities(func.max(Transaction.date)).scalar()
    last_by_source = dict(
        from_bank.with_entities(Transaction.source, func.max(Transaction.date))
        .group_by(Transaction.source).all()
    )
    last_any = max(last_by_source.values(), default=None)

    # Each day through the last day the bank files reach, however quiet.
    daily = []
    running = Decimal("0")
    if data_through is not None:
        day = start
        while day <= data_through:
            running += spent_on.get(day, Decimal("0"))
            daily.append({"date": day.isoformat(), "cumulative_cents": money.to_cents(running)})
            day += timedelta(days=1)

    spendable_plan = money.to_cents(sum(plan[k] for k in SPENDABLE_TYPES))
    days_total = (end - start).days + 1
    pace_delta_cents = None
    if data_through is not None:
        days_covered = (data_through - start).days + 1
        expected = spendable_plan * days_covered // days_total
        pace_delta_cents = money.to_cents(running) - expected

    behind_months = []
    if last_any is not None:
        y, m = label_month_for_date(last_any, start_day)
        while (y, m) <= current_label:
            behind_months.append(f"{y}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    is_current = (year, mo) == current_label
    return {
        "month": f"{year}-{mo:02d}",
        "current_month": f"{current_label[0]}-{current_label[1]:02d}",
        "status": "ok" if data_through else ("gap" if last_any else "empty"),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "today": today.isoformat(),
        "days_total": days_total,
        "day_number": (today - start).days + 1 if is_current else None,
        "days_left": (end - today).days if is_current else None,
        "plan_cents": {k: money.to_cents(v) for k, v in plan.items()},
        "actual_cents": {k: money.to_cents(v) for k, v in actual.items()},
        "spendable_plan_cents": spendable_plan,
        "spendable_actual_cents": money.to_cents(sum(actual[k] for k in SPENDABLE_TYPES)),
        "pace_delta_cents": pace_delta_cents,
        "daily": daily,
        "data_through": data_through.isoformat() if data_through else None,
        "last_import_by_bank": [
            {"source": s.value, "last_date": last_by_source[s].isoformat() if s in last_by_source else None}
            for s in BANK_SOURCES
        ],
        "behind_months": behind_months,
        "to_review": db.query(func.count(Transaction.id)).filter(
            Transaction.confirmed == False).scalar(),  # noqa: E712
    }


def _minus_months(y: int, m: int, k: int) -> tuple[int, int]:
    total = y * 12 + (m - 1) - k
    return total // 12, total % 12 + 1


def _savings_rate_bps(income_cents: int, expenses_cents: int):
    """Savings rate as integer basis points, HALF_UP, on cents ints.

    round_half_up((income - expenses) / income * 10000) via divmod integer
    math only (no floats); None when income <= 0 (undefined/negative-income
    months carry no meaningful rate).
    """
    if income_cents <= 0:
        return None
    q, r = divmod((income_cents - expenses_cents) * 10000, income_cents)
    return q + 1 if 2 * r >= income_cents else q


@router.get("/trends")
def trends(
    months: int = Query(12, ge=1, le=24),
    end_month: str | None = Query(None),
    db: Session = Depends(get_db),
):
    if end_month is not None:
        try:
            parsed = datetime.strptime(end_month, "%Y-%m")
            year, mo = parsed.year, parsed.month
        except ValueError:
            raise HTTPException(status_code=422,
                                detail="end_month must be in YYYY-MM format")
    else:
        year, mo = label_month_for_date(
            date.today(), spend_service.get_start_day(db))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}
    exclude_cat_ids = {c.id for c in cats if _cat_type(c) == "exclude"}
    savings_cat_ids = {cid for cid, c in cat_map.items()
                       if _cat_type(c) == "savings"}

    series: list[dict] = []
    prev: dict | None = None
    for k in range(months - 1, -1, -1):
        y, m = _minus_months(year, mo, k)
        bounds = spend_service.financial_month_bounds(
            db, y, m, materialise=True)
        parts = spend_service.confirmed_parts_in_range(db, *bounds)

        # Spend contribution is -amount, so refund parts net against expenses
        spend_totals = spend_service.spend_totals_by_category(
            parts, exclude_cat_ids)
        total_expenses = sum(spend_totals.values())
        income_totals = spend_service.income_totals_by_category(
            parts, exclude_cat_ids)
        total_income = sum(income_totals.values())

        expense_breakdown = {
            cid: actual for cid, actual in spend_totals.items()
            if cid in cat_map and _cat_type(cat_map[cid]) in EXPENSE_TYPES
        }
        needs_cents = money.to_cents(sum(
            v for cid, v in expense_breakdown.items()
            if _cat_type(cat_map[cid]) == "needs"))
        wants_cents = money.to_cents(sum(
            v for cid, v in expense_breakdown.items()
            if _cat_type(cat_map[cid]) == "wants"))
        savings_cents = money.to_cents(sum(
            v for cid, v in spend_totals.items() if cid in savings_cat_ids))

        total_expenses_cents = money.to_cents(total_expenses)
        total_income_cents = money.to_cents(total_income)
        net_cents = money.to_cents(total_income - total_expenses)
        rate_bps = _savings_rate_bps(total_income_cents, total_expenses_cents)

        top_categories = [
            {"category_id": cid, "category_name": cat_map[cid].name,
             "type": _cat_type(cat_map[cid]),
             "actual_cents": money.to_cents(actual)}
            for cid, actual in sorted(
                expense_breakdown.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
        ]

        entry = {
            "month": f"{y}-{m:02d}",
            "total_expenses_cents": total_expenses_cents,
            "needs_cents": needs_cents,
            "wants_cents": wants_cents,
            "savings_cents": savings_cents,
            "total_income_cents": total_income_cents,
            "net_cents": net_cents,
            "savings_rate_bps": rate_bps,
            "top_categories": top_categories,
        }
        if prev is None:
            entry["mom_deltas"] = None
        else:
            entry["mom_deltas"] = {
                "total_expenses_cents":
                    total_expenses_cents - prev["total_expenses_cents"],
                "needs_cents": needs_cents - prev["needs_cents"],
                "wants_cents": wants_cents - prev["wants_cents"],
                "savings_cents": savings_cents - prev["savings_cents"],
                "total_income_cents":
                    total_income_cents - prev["total_income_cents"],
                "net_cents": net_cents - prev["net_cents"],
                "savings_rate_bps":
                    rate_bps - prev["savings_rate_bps"]
                    if rate_bps is not None
                    and prev["savings_rate_bps"] is not None
                    else None,
            }
        series.append(entry)
        prev = entry

    return {
        "months_requested": months,
        "start_month": series[0]["month"],
        "end_month": series[-1]["month"],
        "series": series,
    }
