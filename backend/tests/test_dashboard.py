import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    cat = db.query(Category).filter_by(name="Food - Essential").first()
    db.add(Transaction(
        date=date(2026, 3, 5), amount=Decimal("-67.40"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 10), amount=Decimal("3460.26"),
        description="Salaris", source="ing",
        confirmed=True, categorised_by="rule", import_hash="hash-test-2",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_dashboard_summary(client):
    r = client.get("/dashboard/summary?month=2026-03")
    assert r.status_code == 200
    body = r.json()
    assert "total_income" in body
    assert "total_expenses" in body
    assert "category_breakdown" in body
    assert float(body["total_income"]) == 3460.26
    assert float(body["total_expenses"]) == 67.40
