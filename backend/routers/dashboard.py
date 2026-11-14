from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload
from decimal import Decimal
from datetime import date, datetime, timedelta
from aggregate import is_spend_part, spend_contribution
from db import get_db
from financial_month import label_month_for_date
from models import Budget, Category, Transaction, TransactionSource
from routers.budget import _auto_populate
from routers import recurring as recurring_router
import clock
import money
import set_asides
import spend_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

EXPENSE_TYPES = ("needs", "wants", "savings")
SPENDABLE_TYPES = ("needs", "wants")
EARLY_DAYS = 5  # before this many days have passed there is too little to say where anything is heading
BIG_PAYMENT = Decimal("0.1")  # a day with a payment this share of the spendable plan is rent or an allowance
BANK_SOURCES = (TransactionSource.ing,)


def _today() -> date:
    return clock.today()


def _cat_type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    start_date, end_date = spend_service.financial_month_bounds(db, year, mo)
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
    start, end = spend_service.financial_month_bounds(db, year, mo)
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
    money_in = Decimal("0")  # as the whole month's Income counts it
    for tx in confirmed:
        for category_id, amount, is_refund in set_asides.counted_parts(tx, start_day):
            kind = types.get(category_id)
            if category_id is not None and kind != "exclude" and amount > 0 and not is_refund:
                money_in += amount
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
    spendable_actual = money.to_cents(sum(actual[k] for k in SPENDABLE_TYPES))
    early = is_current and (today - start).days + 1 <= EARLY_DAYS
    ordinary = _ordinary_days(daily, spendable_plan, today, days_total, start) if data_through is not None else None
    free = _free_to_spend(
        db, f"{year}-{mo:02d}", spendable_plan - spendable_actual, (end - today).days,
        money_in_cents=money.to_cents(money_in), spent_cents=spendable_actual,
        saved_cents=money.to_cents(actual["savings"]), savings_plan_cents=money.to_cents(plan["savings"]),
        ordinary=ordinary, remaining_days=(end - min(data_through, today)).days if data_through else 0,
        early=early,
    ) if is_current and data_through is not None else None
    waiting = db.query(Transaction).filter(Transaction.confirmed == False).all()  # noqa: E712
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
        "spendable_actual_cents": spendable_actual,
        "free": free,
        "money_in_cents": money.to_cents(money_in),
        "ordinary_day": None if early else ordinary,
        "newest_bank_date": last_any.isoformat() if last_any else None,
        "pace_delta_cents": pace_delta_cents,
        "daily": daily,
        "data_through": data_through.isoformat() if data_through else None,
        "last_import_by_bank": [
            {"source": s.value, "last_date": last_by_source[s].isoformat() if s in last_by_source else None}
            for s in BANK_SOURCES
        ],
        "behind_months": behind_months,
        "to_review": len(waiting),
        "to_review_in_month": sum(1 for t in waiting if start <= t.date <= end),
    }


def _ordinary_days(daily: list[dict], plan_cents: int, today: date, days_total: int, start: date) -> dict | None:
    """The average day over finished days only (before today), leaving out days with a big payment.

    `daily` runs through the last day the bank files reach, which can be today's part day; that day is
    not finished and is not averaged. None when nothing can be said (no plan, no ordinary day yet).
    """
    if plan_cents <= 0:
        return None
    limit = plan_cents * BIG_PAYMENT
    spent, previous = [], 0
    for day in daily:
        if date.fromisoformat(day["date"]) < today:
            spent.append(day["cumulative_cents"] - previous)
        previous = day["cumulative_cents"]
    ordinary = [c for c in spent if c < limit]
    if not ordinary:
        return None
    total = sum(ordinary)
    return {"avg_cents": max(0, round(total / len(ordinary))), "days": len(ordinary), "spent_cents": total}


def _free_to_spend(db: Session, label: str, left_cents: int, days_left: int, *, money_in_cents: int, spent_cents: int,
                   saved_cents: int, savings_plan_cents: int, ordinary: dict | None,
                   remaining_days: int, early: bool) -> dict:
    """What can still be spent freely this month.

    `free_cents` (the plan's view): what is left in the plan, less the fixed bills that have not been
    debited yet and less what this month sets aside for later bills.
    `cash_left_cents` (the money's view): money in so far + income still expected - spent so far (needs and
    wants) - saved so far - savings still to put aside as planned - the same bills and set-asides.
    """
    bills = [
        {"key": i["key"], "name": i["name"], "amount_cents": i["amount_cents"] * i["remaining"],
         "next_date": i["next_date"], "category_name": i["category_name"]}
        for i in recurring_router.recurring(label, db)["items"]
        if i["state"] in ("due", "expected") and i["category_type"] in SPENDABLE_TYPES
    ]
    expected = recurring_router.expected_income(label, db)
    kept = set_asides.month_view(db, label)
    bills_cents = sum(b["amount_cents"] for b in bills)
    free = left_cents - bills_cents - kept["set_aside_cents"]
    to_save = max(0, savings_plan_cents - saved_cents)
    cash = (money_in_cents + expected["expected_cents"] - spent_cents - saved_cents
            - to_save - bills_cents - kept["set_aside_cents"])
    average = None if early or ordinary is None else ordinary["avg_cents"]
    return {
        "money_in_cents": money_in_cents,
        "income_expected_cents": expected["expected_cents"],
        "income_expected": [
            {"key": i["key"], "name": i["name"], "amount_cents": i["amount_cents"] * i["remaining"],
             "next_date": i["next_date"]}
            for i in expected["items"]
        ],
        "spent_cents": spent_cents,
        "saved_cents": saved_cents,
        "to_save_cents": to_save,
        "cash_left_cents": cash,
        # What the plan leaves out: income above it, or a plan that is not fully spent.
        "outside_plan_cents": cash - free,
        "still_to_come_cents": bills_cents + kept["set_aside_cents"] + to_save,
        "avg_day_cents": average,
        "avg_day_days": None if average is None else ordinary["days"],
        "avg_day_spent_cents": None if average is None else ordinary["spent_cents"],
        "days_ahead": remaining_days,
        "month_end_cents": None if average is None else cash - average * remaining_days,
        "free_cents": free,
        # Today can still be spent, so it counts.
        "per_day_cents": free // (days_left + 1) if free > 0 else None,
        "left_in_plan_cents": left_cents,
        "bills_cents": bills_cents,
        "bills": bills,
        "set_aside_cents": kept["set_aside_cents"],
        "set_asides": [
            {"id": i["id"], "name": i["name"], "monthly_cents": i["monthly_cents"]}
            for i in kept["items"] if i["monthly_cents"]
        ],
    }


def _minus_months(y: int, m: int, k: int) -> tuple[int, int]:
    total = y * 12 + (m - 1) - k
    return total // 12, total % 12 + 1


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
            clock.today(), spend_service.get_start_day(db))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}
    exclude_cat_ids = {c.id for c in cats if _cat_type(c) == "exclude"}
    savings_cat_ids = {cid for cid, c in cat_map.items()
                       if _cat_type(c) == "savings"}

    series: list[dict] = []
    for k in range(months - 1, -1, -1):
        y, m = _minus_months(year, mo, k)
        bounds = spend_service.financial_month_bounds(db, y, m)
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

        entry = {
            "month": f"{y}-{m:02d}",
            "total_expenses_cents": total_expenses_cents,
            "needs_cents": needs_cents,
            "wants_cents": wants_cents,
            "savings_cents": savings_cents,
            "total_income_cents": total_income_cents,
            "net_cents": net_cents,
        }
        series.append(entry)

    return {
        "months_requested": months,
        "start_month": series[0]["month"],
        "end_month": series[-1]["month"],
        "series": series,
    }
