"""Shared aggregation queries for the dashboard/budget/transactions routers.

Single seam for: financial-month bounds, the confirmed-transactions query,
and effective-parts grouping (S4). Every total in the app flows through here;
routers must not hand-roll these loops."""
from decimal import Decimal
from sqlalchemy.orm import Session, selectinload
from models import Transaction, Setting
from financial_month import get_financial_month_range
from aggregate import effective_parts, is_spend_part, spend_contribution
from adjustments import materialise_standing_adjustments

DEFAULT_START_DAY = 24


def get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else DEFAULT_START_DAY


def financial_month_bounds(db, year, mo, materialise=False):
    """(start_date, end_date) for label month year-mo; optionally materialises
    standing adjustments first (same call sites as today)."""
    start_day = get_start_day(db)
    if materialise:
        materialise_standing_adjustments(year, mo, start_day, db)
    return get_financial_month_range(year, mo, start_day)


def confirmed_parts_in_range(db, start_date, end_date):
    txs = db.query(Transaction).options(selectinload(Transaction.splits)).filter(
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.confirmed == True,  # noqa: E712 — historic form
    ).all()
    return [p for t in txs for p in effective_parts(t)]


def spend_totals_by_category(parts, skip_cat_ids=frozenset()):
    """category_id -> spend contribution (refunds netted) for spend-bearing
    parts outside skip_cat_ids. Mirrors the former dashboard/budget loops:
    is_spend_part(amount, refund) gates, spend_contribution signs."""
    totals: dict[int, Decimal] = {}
    for cid, amount, refund in parts:
        if cid is None or cid in skip_cat_ids:
            continue
        if is_spend_part(amount, refund):
            totals[cid] = totals.get(cid, Decimal("0")) + spend_contribution(amount, refund)
    return totals


def income_totals_by_category(parts, skip_cat_ids=frozenset()):
    """category_id -> sum of positive, non-refund parts (true income only)."""
    totals: dict[int, Decimal] = {}
    for cid, amount, refund in parts:
        if cid is None or cid in skip_cat_ids:
            continue
        if amount > 0 and not refund:
            totals[cid] = totals.get(cid, Decimal("0")) + amount
    return totals
