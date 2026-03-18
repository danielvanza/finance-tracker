import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category, Setting


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)

    cat = db.query(Category).filter_by(name="Food - Essential").first()
    salary_cat = db.query(Category).filter_by(name="Salary").first()

    # Transaction on Mar 25 — inside "April 2026" financial month (start_day=24: Mar 24 – Apr 23)
    db.add(Transaction(
        date=date(2026, 3, 25), amount=Decimal("-67.40"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-1",
    ))
    # Income on Mar 24 — also inside "April 2026" financial month
    db.add(Transaction(
        date=date(2026, 3, 24), amount=Decimal("3460.26"),
        description="Salaris", source="ing",
        category_id=salary_cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-2",
    ))
    # Transaction on Mar 23 — inside "March 2026" (Feb 24 – Mar 23), NOT April
    db.add(Transaction(
        date=date(2026, 3, 23), amount=Decimal("-20.00"),
        description="Bol.com", source="revolut",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-3",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_dashboard_uses_financial_month(client):
    """April 2026 with start_day=24 should include Mar 24–Apr 23 transactions."""
    r = client.get("/dashboard/summary?month=2026-04")
    assert r.status_code == 200
    body = r.json()
    # Mar 25 expense and Mar 24 income are in April financial month
    assert float(body["total_income"]) == 3460.26
    assert float(body["total_expenses"]) == 67.40


def test_dashboard_excludes_out_of_range(client):
    """Mar 23 transaction should NOT appear in April 2026 (start_day=24)."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    # Only 67.40 expense, NOT 67.40 + 20.00
    assert float(body["total_expenses"]) == 67.40


def test_dashboard_income_breakdown(client):
    """Dashboard should include income_breakdown with categorised income."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "income_breakdown" in body
    assert len(body["income_breakdown"]) == 1
    assert body["income_breakdown"][0]["category_name"] == "Salary"
    assert float(body["income_breakdown"][0]["amount"]) == 3460.26


def test_dashboard_category_breakdown_excludes_income(client):
    """category_breakdown should only include expense categories."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    for item in body["category_breakdown"]:
        assert item["type"] != "income"


def test_dashboard_monthly_trend_uses_financial_months(client):
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "monthly_trend" in body
    assert len(body["monthly_trend"]) == 6
    # The current month in trend should be "2026-04"
    assert body["monthly_trend"][-1]["month"] == "2026-04"
