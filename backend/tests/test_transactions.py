import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Transaction, Category
from seed import run_seed

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    cat = db.query(Category).first()
    db.add(Transaction(
        date=date(2026, 3, 1), amount=Decimal("-45.00"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 2), amount=Decimal("-10.00"),
        description="Bol.com", source="revolut",
        category_id=cat.id, confirmed=False, categorised_by="ai",
        ai_confidence=0.7, import_hash="hash2",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_list_transactions(client):
    r = client.get("/transactions")
    assert r.status_code == 200
    assert len(r.json()) == 2

def test_unconfirmed_first(client):
    r = client.get("/transactions")
    items = r.json()
    assert items[0]["confirmed"] is False

def test_filter_by_confirmed(client):
    r = client.get("/transactions?confirmed=false")
    items = r.json()
    assert all(not i["confirmed"] for i in items)

def test_patch_transaction(client, db):
    tx = db.query(Transaction).filter_by(import_hash="hash2").first()
    r = client.patch(f"/transactions/{tx.id}", json={"confirmed": True})
    assert r.status_code == 200
    assert r.json()["confirmed"] is True

def test_review_endpoint_returns_unconfirmed(client):
    r = client.get("/transactions/review")
    assert r.status_code == 200
    assert r.json()["confirmed"] is False


def test_filter_by_financial_month(client, db):
    """Transactions should filter by financial month, not calendar month."""
    from models import Setting
    # Default start_day=24 from seed. Our fixture transactions are dated Mar 1 and Mar 2.
    # "March 2026" financial month = Feb 24 – Mar 23. Both should be included.
    r = client.get("/transactions?month=2026-03")
    items = r.json()
    assert len(items) == 2

    # "April 2026" financial month = Mar 24 – Apr 23. Neither should be included.
    r2 = client.get("/transactions?month=2026-04")
    items2 = r2.json()
    assert len(items2) == 0


def test_create_rule_sign_aware_skips_incompatible(client, db):
    """Create-rule from an expense tx should not retroactively assign to income transactions."""
    from models import Transaction, Category
    from decimal import Decimal
    from datetime import date as dt_date

    income_tx = Transaction(
        date=dt_date(2026, 3, 3), amount=Decimal("100.00"),
        description="Albert Heijn Refund", source="ing",
        confirmed=False, import_hash="hash-sign-1",
    )
    db.add(income_tx)
    db.commit()

    # hash1 is the expense "Albert Heijn" from fixture — confirm it and create rule
    expense_tx = db.query(Transaction).filter_by(import_hash="hash1").first()
    # Ensure it has a category (from fixture)
    r = client.post(f"/transactions/{expense_tx.id}/create-rule")
    assert r.status_code == 200

    # The income tx with "Albert Heijn Refund" should NOT be retroactively assigned
    db.refresh(income_tx)
    assert income_tx.confirmed is False
