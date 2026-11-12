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
        description="Bol.com", source="ing",
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
    assert body["total_income_cents"] == 346026
    assert body["total_expenses_cents"] == 6740


def test_dashboard_excludes_out_of_range(client):
    """Mar 23 transaction should NOT appear in April 2026 (start_day=24)."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    # Only 67.40 expense, NOT 67.40 + 20.00
    assert body["total_expenses_cents"] == 6740


def test_dashboard_income_breakdown(client):
    """Dashboard should include income_breakdown with categorised income."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "income_breakdown" in body
    assert len(body["income_breakdown"]) == 1
    assert body["income_breakdown"][0]["category_name"] == "Salary"
    assert body["income_breakdown"][0]["amount_cents"] == 346026


def test_dashboard_category_breakdown_excludes_income(client):
    """category_breakdown should only include expense categories."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    for item in body["category_breakdown"]:
        assert item["type"] != "income"


TRENDS_ENTRY_KEYS = {
    "month", "total_expenses_cents", "needs_cents", "wants_cents",
    "savings_cents", "total_income_cents", "net_cents", "savings_rate_bps",
    "top_categories", "mom_deltas",
}


@pytest.fixture
def trends_client(db):
    """Factory in the client-fixture style: seed via run_seed + explicit
    Transaction rows (import_hash auto-assigned), TestClient via dependency
    override. rows: {date, amount, description, category, confirmed=True,
    is_refund=False, source="ing"}."""
    def _make(rows):
        app.dependency_overrides[get_db] = lambda: db
        run_seed(db)
        cat_ids = {c.name: c.id for c in db.query(Category).all()}
        for i, row in enumerate(rows):
            confirmed = row.get("confirmed", True)
            db.add(Transaction(
                date=row["date"],
                amount=Decimal(row["amount"]),
                description=row["description"],
                source=row.get("source", "ing"),
                category_id=cat_ids[row["category"]],
                confirmed=confirmed,
                categorised_by="rule" if confirmed else "ai",
                is_refund=row.get("is_refund", False),
                import_hash=f"trends-hash-{i}",
            ))
        db.commit()
        return TestClient(app)
    yield _make
    app.dependency_overrides.clear()


def _month_entry(body, label):
    return next(e for e in body["series"] if e["month"] == label)


def test_trends_excludes_exclude_type_categories(trends_client, db):
    client = trends_client([
        {"date": date(2026, 3, 25), "amount": "-60.00", "description": "Food April", "category": "Food - Essential"},
        {"date": date(2026, 3, 26), "amount": "-80.00", "description": "Internal move", "category": "Internal Transfer"},
    ])
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-04"})
    assert r.status_code == 200
    april = _month_entry(r.json(), "2026-04")
    # Exclude-cat spend is dropped from every bucket
    assert april["total_expenses_cents"] == 6000
    assert april["needs_cents"] == 6000
    assert april["wants_cents"] == 0 and april["savings_cents"] == 0
    assert april["total_income_cents"] == 0

    # Totals unchanged vs without the exclude transaction
    move_tx = db.query(Transaction).filter_by(description="Internal move").one()
    db.delete(move_tx)
    db.commit()
    r2 = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-04"})
    april2 = _month_entry(r2.json(), "2026-04")
    assert april2["total_expenses_cents"] == april["total_expenses_cents"] == 6000


def test_trends_refunds_net_into_expenses(trends_client):
    client = trends_client([
        {"date": date(2026, 3, 25), "amount": "-100.00", "description": "Food big", "category": "Food - Essential"},
        {"date": date(2026, 3, 26), "amount": "40.00", "description": "Food refund",
         "category": "Food - Essential", "is_refund": True},
    ])
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-04"})
    assert r.status_code == 200
    april = _month_entry(r.json(), "2026-04")
    # -100.00 spend + +40.00 refund nets to 6000c expenses
    assert april["total_expenses_cents"] == 6000
    # The refund must NOT count as income
    assert april["total_income_cents"] == 0


def test_trends_ignores_unconfirmed_transactions(trends_client):
    client = trends_client([
        {"date": date(2026, 3, 25), "amount": "2500.00", "description": "Salaris April", "category": "Salary"},
        {"date": date(2026, 3, 26), "amount": "-60.00", "description": "Food April", "category": "Food - Essential"},
        {"date": date(2026, 3, 27), "amount": "-999.00", "description": "Unconfirmed spend",
         "category": "Food - Essential", "confirmed": False},
        {"date": date(2026, 3, 28), "amount": "500.00", "description": "Unconfirmed income",
         "category": "Salary", "confirmed": False},
    ])
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-04"})
    assert r.status_code == 200
    april = _month_entry(r.json(), "2026-04")
    # Only the confirmed pair counts; unconfirmed rows contribute nothing
    assert april["total_income_cents"] == 250000
    assert april["total_expenses_cents"] == 6000
    assert april["needs_cents"] == 6000


def test_trends_chronological_order_and_windowing(trends_client):
    # Mar 23 is inside label March (Feb 24 – Mar 23); Mar 25 inside label April
    client = trends_client([
        {"date": date(2026, 3, 23), "amount": "-20.00", "description": "Bol.com March", "category": "Food - Essential"},
        {"date": date(2026, 3, 25), "amount": "-67.40", "description": "Albert Heijn April", "category": "Food - Essential"},
    ])
    r = client.get("/dashboard/trends", params={"months": 4, "end_month": "2026-04"})
    assert r.status_code == 200
    body = r.json()
    labels = [e["month"] for e in body["series"]]
    assert labels == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert body["start_month"] == "2026-01" and body["end_month"] == "2026-04"
    jan, feb, march, april = body["series"]
    # Mar 25 tx lands in label April, Mar 23 tx in label March
    assert jan["total_expenses_cents"] == 0
    assert feb["total_expenses_cents"] == 0
    assert march["total_expenses_cents"] == 2000
    assert april["total_expenses_cents"] == 6740


def test_trends_param_validation(trends_client):
    client = trends_client([])
    assert client.get("/dashboard/trends",
                      params={"months": 0, "end_month": "2026-04"}).status_code == 422
    assert client.get("/dashboard/trends",
                      params={"months": 25, "end_month": "2026-04"}).status_code == 422
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-13"})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
