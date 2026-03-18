import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category, CategoryType

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_budget_autopopulates_from_defaults(client):
    r = client.get("/budget?month=2026-04")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    names = [r["category_name"] for r in rows]
    assert "Food - Essential" in names


def test_budget_excludes_income_categories(client, db):
    """Income categories should not appear in budget rows."""
    r = client.get("/budget?month=2026-04")
    rows = r.json()
    names = [r["category_name"] for r in rows]
    assert "Salary" not in names
    assert "Refunds" not in names
    assert "Other Income" not in names


def test_budget_actual_uses_financial_month(client, db):
    """Actual spend should use financial month date range, not calendar month."""
    cat = db.query(Category).filter_by(name="Food - Essential").first()
    # Mar 25 is inside "April 2026" financial month (start_day=24: Mar 24–Apr 23)
    db.add(Transaction(
        date=date(2026, 3, 25), amount=Decimal("-100.00"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-budget-1",
    ))
    # Mar 23 is inside "March 2026" financial month (Feb 24–Mar 23), NOT April
    db.add(Transaction(
        date=date(2026, 3, 23), amount=Decimal("-50.00"),
        description="Lidl", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-budget-2",
    ))
    db.commit()

    r = client.get("/budget?month=2026-04")
    rows = r.json()
    food_row = next(r for r in rows if r["category_name"] == "Food - Essential")
    # Only Mar 25 transaction should count for April budget
    assert float(food_row["actual_amount"]) == 100.00


def test_budget_patch_updates_amount(client, db):
    r = client.get("/budget?month=2026-04")
    row = r.json()[0]
    new_amount = float(row["planned_amount"]) + 100
    r2 = client.patch(f"/budget/{row['id']}", json={"planned_amount": new_amount})
    assert r2.status_code == 200
    assert float(r2.json()["planned_amount"]) == new_amount
