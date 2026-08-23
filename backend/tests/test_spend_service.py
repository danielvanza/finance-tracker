import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Transaction, TransactionSplit, Category
from seed import run_seed
import spend_service


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _seed_dashboard_trio(db):
    """The exact test_dashboard fixture trio (parity anchor)."""
    cat = db.query(Category).filter_by(name="Food - Essential").first()
    salary_cat = db.query(Category).filter_by(name="Salary").first()
    db.add(Transaction(
        date=date(2026, 3, 25), amount=Decimal("-67.40"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 24), amount=Decimal("3460.26"),
        description="Salaris", source="ing",
        category_id=salary_cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-2",
    ))
    db.add(Transaction(
        date=date(2026, 3, 23), amount=Decimal("-20.00"),
        description="Bol.com", source="revolut",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-3",
    ))
    db.commit()


def test_parity_with_legacy_fixture(client, db):
    """Exact cent values on the pre-refactor dashboard fixture trio."""
    _seed_dashboard_trio(db)

    r = client.get("/dashboard/summary?month=2026-04")
    assert r.status_code == 200
    body = r.json()
    assert body["total_income_cents"] == 346026
    assert body["total_expenses_cents"] == 6740
    assert body["left_over_cents"] == 339286
    last = body["monthly_trend"][-1]
    assert isinstance(last["total_cents"], int)
    assert last["month"] == "2026-04"

    # Budget actuals flow through the same service seam.
    food = db.query(Category).filter_by(name="Food - Essential").one()
    april_rows = client.get("/budget?month=2026-04").json()
    food_april = next(row for row in april_rows if row["category_id"] == food.id)
    # Financial April = Mar 24 – Apr 23: the Mar 25 Albert Heijn spend counts.
    assert food_april["actual_amount_cents"] == 6740

    march_rows = client.get("/budget?month=2026-03").json()
    food_march = next(row for row in march_rows if row["category_id"] == food.id)
    # Financial March = Feb 24 – Mar 23: only the Mar 23 Bol.com spend counts.
    assert food_march["actual_amount_cents"] == 2000


def test_spend_totals_skips_uncategorised_and_skipped_categories():
    parts = [
        (None, Decimal("-10.00"), False),
        (1, Decimal("-10.00"), False),
        (2, Decimal("-5.00"), False),
    ]
    totals = spend_service.spend_totals_by_category(parts, skip_cat_ids={2})
    assert totals == {1: Decimal("10.00")}


def test_spend_totals_nets_refund_parts():
    parts = [
        (7, Decimal("-30.00"), False),
        (7, Decimal("12.00"), True),
    ]
    totals = spend_service.spend_totals_by_category(parts)
    assert totals == {7: Decimal("18.00")}


def test_income_totals_ignores_refunds_and_negatives():
    parts = [
        (3, Decimal("100.00"), False),
        (3, Decimal("40.00"), True),
        (4, Decimal("-9.00"), False),
        (None, Decimal("500.00"), False),
    ]
    totals = spend_service.income_totals_by_category(parts)
    assert totals == {3: Decimal("100.00")}


def test_empty_parts_yield_empty_maps():
    assert spend_service.spend_totals_by_category([]) == {}
    assert spend_service.income_totals_by_category([]) == {}


def test_null_and_explicit_flag_parts_net_through_service(client, db):
    """Service-level mirror of test_split_refunds: a parent-flagged refund
    split (NULL-flag rows inherit) nets against prior spend; an explicitly
    flagged part behaves identically."""
    food = db.query(Category).filter_by(name="Food - Essential").one()
    misc = db.query(Category).filter_by(name="Miscellaneous").one()

    db.add(Transaction(
        date=date(2026, 3, 1), amount=Decimal("-60.00"),
        description="groceries", source="ing", category_id=food.id,
        confirmed=True, import_hash="svc-hash-1",
    ))
    refund = Transaction(
        date=date(2026, 3, 2), amount=Decimal("90.00"),
        description="combined refund", source="ing",
        confirmed=True, is_refund=True, import_hash="svc-hash-2",
    )
    db.add(refund)
    db.flush()
    db.add(TransactionSplit(transaction_id=refund.id, category_id=food.id,
                            amount=Decimal("60.00"), is_refund=None))
    db.add(TransactionSplit(transaction_id=refund.id, category_id=misc.id,
                            amount=Decimal("30.00"), is_refund=True))
    db.commit()

    start_date, end_date = spend_service.financial_month_bounds(db, 2026, 3)
    parts = spend_service.confirmed_parts_in_range(db, start_date, end_date)
    totals = spend_service.spend_totals_by_category(parts)

    assert totals[food.id] == Decimal("0.00")   # -60 spend + 60 netted refund
    assert totals[misc.id] == Decimal("-30.00")
