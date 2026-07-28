from datetime import date
from sqlalchemy.orm import Session
from models import StandingAdjustment, Transaction, TransactionSource, CategorisedBy
from importers.base import make_hash
from financial_month import get_financial_month_range


def materialise_standing_adjustments(year: int, month: int, start_day: int, db: Session) -> None:
    """Create the net-zero manual pair for each active standing adjustment in
    the given financial month, if not already present.

    Future months are left alone so browsing ahead doesn't fabricate history.
    A month that already has any row for an adjustment is skipped entirely —
    deleting a materialised row is treated as opting out for that month.
    """
    start_date, end_date = get_financial_month_range(year, month, start_day)
    if start_date > date.today():
        return
    # The 1st of the label month always falls inside the financial range
    # for any start_day in 1..28.
    label_date = date(year, month, 1)
    adjustments = db.query(StandingAdjustment).filter(StandingAdjustment.active == True).all()
    created = False
    for sa in adjustments:
        if label_date < sa.start_month:
            continue
        exists = db.query(Transaction.id).filter(
            Transaction.standing_adjustment_id == sa.id,
            Transaction.date >= start_date,
            Transaction.date <= end_date,
        ).first()
        if exists:
            continue
        for leg_amount, category_id, leg in (
            (sa.amount, sa.income_category_id, "income"),
            (-sa.amount, sa.expense_category_id, "expense"),
        ):
            db.add(Transaction(
                date=label_date,
                amount=leg_amount,
                description=sa.name,
                source=TransactionSource.manual,
                category_id=category_id,
                confirmed=True,
                categorised_by=CategorisedBy.manual,
                import_hash=make_hash("manual", label_date, leg_amount, sa.name, f"sa:{sa.id}", leg),
                standing_adjustment_id=sa.id,
            ))
        created = True
    if created:
        db.commit()
