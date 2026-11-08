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


def test_dashboard_monthly_trend_uses_financial_months(client):
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "monthly_trend" in body
    assert len(body["monthly_trend"]) == 6
    # The current month in trend should be "2026-04"
    assert body["monthly_trend"][-1]["month"] == "2026-04"


# ---------------------------------------------------------------------------
# GET /dashboard/trends — behaviour (t_e5da18e6 phase 3)
# ---------------------------------------------------------------------------

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


def test_trends_savings_rate_math(trends_client):
    # Label 2026-03 window (Feb 24 – Mar 23): income 100000c / exp 5000c → 9500 bps
    # Label 2026-04 window (Mar 24 – Apr 23): income 250000c / exp 6000c → 9760 bps
    # Label 2026-05 window (Apr 24 – May 23): income 0 / exp 7000c → null rate
    client = trends_client([
        {"date": date(2026, 2, 25), "amount": "1000.00", "description": "Salaris March", "category": "Salary"},
        {"date": date(2026, 2, 26), "amount": "-50.00", "description": "Food March", "category": "Food - Essential"},
        {"date": date(2026, 3, 25), "amount": "2500.00", "description": "Salaris April", "category": "Salary"},
        {"date": date(2026, 3, 26), "amount": "-60.00", "description": "Food April", "category": "Food - Essential"},
        {"date": date(2026, 4, 25), "amount": "-70.00", "description": "Food May", "category": "Food - Essential"},
    ])
    r = client.get("/dashboard/trends", params={"months": 3, "end_month": "2026-05"})
    assert r.status_code == 200
    body = r.json()
    assert body["months_requested"] == 3
    assert body["start_month"] == "2026-03" and body["end_month"] == "2026-05"

    march = _month_entry(body, "2026-03")
    assert march["total_income_cents"] == 100000
    assert march["total_expenses_cents"] == 5000
    assert march["savings_rate_bps"] == 9500
    assert march["net_cents"] == 95000

    april = _month_entry(body, "2026-04")
    assert april["total_income_cents"] == 250000
    assert april["total_expenses_cents"] == 6000
    assert april["savings_rate_bps"] == 9760  # (250000-6000)/250000 * 10000 exact
    assert april["net_cents"] == 244000

    may = _month_entry(body, "2026-05")
    assert may["total_income_cents"] == 0
    assert may["total_expenses_cents"] == 7000
    assert may["savings_rate_bps"] is None
    # Previous month had a rate, but income-0 month's delta rate is null too
    assert may["mom_deltas"]["savings_rate_bps"] is None


def test_trends_mom_deltas(trends_client):
    # April: income 200000c, needs 5000c, wants 3000c, savings 2000c → exp 10000c, net 190000c
    # May:   income 150000c, needs 4000c, wants 1000c, savings  500c → exp  5500c, net 144500c
    client = trends_client([
        {"date": date(2026, 3, 25), "amount": "2000.00", "description": "Salaris April", "category": "Salary"},
        {"date": date(2026, 3, 26), "amount": "-50.00", "description": "Food April", "category": "Food - Essential"},
        {"date": date(2026, 3, 27), "amount": "-30.00", "description": "Eating out April", "category": "Food - Not Essential"},
        {"date": date(2026, 3, 28), "amount": "-20.00", "description": "DEGIRO April", "category": "DEGIRO"},
        {"date": date(2026, 4, 25), "amount": "1500.00", "description": "Salaris May", "category": "Salary"},
        {"date": date(2026, 4, 26), "amount": "-40.00", "description": "Food May", "category": "Food - Essential"},
        {"date": date(2026, 4, 27), "amount": "-10.00", "description": "Eating out May", "category": "Food - Not Essential"},
        {"date": date(2026, 4, 28), "amount": "-5.00", "description": "DEGIRO May", "category": "DEGIRO"},
    ])
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-05"})
    assert r.status_code == 200
    series = r.json()["series"]
    april, may = series[0], series[1]
    assert april["mom_deltas"] is None

    expected_deltas = {
        "total_expenses_cents": 5500 - 10000,    # -4500
        "needs_cents": 4000 - 5000,              # -1000
        "wants_cents": 1000 - 3000,              # -2000
        "savings_cents": 500 - 2000,             # -1500
        "total_income_cents": 150000 - 200000,   # -50000
        "net_cents": 144500 - 190000,            # -45500
    }
    assert may["mom_deltas"]["total_expenses_cents"] == -4500
    assert may["mom_deltas"]["needs_cents"] == -1000
    assert may["mom_deltas"]["wants_cents"] == -2000
    assert may["mom_deltas"]["savings_cents"] == -1500
    assert may["mom_deltas"]["total_income_cents"] == -50000
    assert may["mom_deltas"]["net_cents"] == -45500
    # Signed deltas equal current-minus-previous for all six cent fields
    for k, expected in expected_deltas.items():
        assert may["mom_deltas"][k] == may[k] - april[k] == expected


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
    # ...and from top_categories
    assert [t["category_name"] for t in april["top_categories"]] == ["Food - Essential"]
    assert [t["actual_cents"] for t in april["top_categories"]] == [6000]

    # Totals unchanged vs without the exclude transaction
    move_tx = db.query(Transaction).filter_by(description="Internal move").one()
    db.delete(move_tx)
    db.commit()
    r2 = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-04"})
    april2 = _month_entry(r2.json(), "2026-04")
    assert april2["total_expenses_cents"] == april["total_expenses_cents"] == 6000
    assert april2["top_categories"] == april["top_categories"]


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
    assert len(april["top_categories"]) == 1
    top = april["top_categories"][0]
    assert top["category_name"] == "Food - Essential"
    assert top["actual_cents"] == 6000


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
    assert [t["actual_cents"] for t in april["top_categories"]] == [6000]


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
    # Deltas confirm the amounts landed in those entries
    assert march["mom_deltas"]["total_expenses_cents"] == 2000
    assert april["mom_deltas"]["total_expenses_cents"] == 4740


def test_trends_param_validation(trends_client):
    client = trends_client([])
    assert client.get("/dashboard/trends",
                      params={"months": 0, "end_month": "2026-04"}).status_code == 422
    assert client.get("/dashboard/trends",
                      params={"months": 25, "end_month": "2026-04"}).status_code == 422
    r = client.get("/dashboard/trends", params={"months": 2, "end_month": "2026-13"})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
