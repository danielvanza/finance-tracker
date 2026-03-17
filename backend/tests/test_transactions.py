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
