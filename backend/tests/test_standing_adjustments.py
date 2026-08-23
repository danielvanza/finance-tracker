import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Transaction, Category, StandingAdjustment
from seed import run_seed


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).first()


def _make_sa(client, db, name="Test allowance", amount="600.00", start_month="2026-01-01"):
    retained = _cat(db, "Retained Salary")
    allowance = _cat(db, "Personal Allowance")
    r = client.post("/standing-adjustments", json={
        "name": name, "amount": amount,
        "income_category_id": retained.id,
        "expense_category_id": allowance.id,
        "start_month": start_month,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["amount_cents"] == 60000  # v2 wire: int cents, not euros
    return body


def test_seeded_standing_adjustments_listed(client):
    rows = client.get("/standing-adjustments").json()
    names = {row["name"] for row in rows}
    assert "Personal allowance — partner 1" in names
    assert "Personal allowance — partner 2" in names
    assert all(isinstance(row["amount_cents"], int) and row["amount_cents"] > 0
               for row in rows)


def test_create_validates_amount_and_category_types(client, db):
    retained = _cat(db, "Retained Salary")
    allowance = _cat(db, "Personal Allowance")
    r = client.post("/standing-adjustments", json={
        "name": "Bad amount", "amount": "-10",
        "income_category_id": retained.id, "expense_category_id": allowance.id,
    })
    assert r.status_code == 422
    # Swapped categories: expense category in the income slot
    r = client.post("/standing-adjustments", json={
        "name": "Swapped", "amount": "600",
        "income_category_id": allowance.id, "expense_category_id": retained.id,
    })
    assert r.status_code == 422


def test_materialises_pair_into_viewed_month(client, db):
    sa = _make_sa(client, db)
    client.get("/dashboard/summary?month=2026-02")
    rows = db.query(Transaction).filter(
        Transaction.standing_adjustment_id == sa["id"]).all()
    assert len(rows) == 2
    assert sum(t.amount for t in rows) == 0
    assert all(t.confirmed for t in rows)
    assert all((t.source.value if hasattr(t.source, "value") else t.source) == "manual"
               for t in rows)
    assert {t.date for t in rows} == {date(2026, 2, 1)}


def test_materialisation_is_idempotent(client, db):
    sa = _make_sa(client, db)
    client.get("/dashboard/summary?month=2026-02")
    client.get("/dashboard/summary?month=2026-02")
    client.get("/transactions?month=2026-02")
    client.get("/budget?month=2026-02")
    count = db.query(Transaction).filter(
        Transaction.standing_adjustment_id == sa["id"],
        Transaction.date >= date(2026, 1, 24), Transaction.date <= date(2026, 2, 23),
    ).count()
    assert count == 2


def test_does_not_materialise_future_or_pre_start_months(client, db):
    sa = _make_sa(client, db, start_month="2026-02-01")
    # Before start_month
    client.get("/dashboard/summary?month=2026-01")
    # Far in the future (financial month hasn't started yet)
    client.get("/dashboard/summary?month=2099-01")
    rows = db.query(Transaction).filter(
        Transaction.standing_adjustment_id == sa["id"]).all()
    assert rows == []


def test_inactive_adjustment_does_not_materialise(client, db):
    sa = _make_sa(client, db)
    client.patch(f"/standing-adjustments/{sa['id']}", json={"active": False})
    client.get("/dashboard/summary?month=2026-02")
    rows = db.query(Transaction).filter(
        Transaction.standing_adjustment_id == sa["id"]).all()
    assert rows == []


def test_materialised_pair_grosses_up_income_without_changing_left_over(client, db):
    salary = _cat(db, "Salary")
    db.add(Transaction(
        date=date(2026, 2, 1), amount=Decimal("3000.00"),
        description="Salary transfer to shared", source="ing",
        category_id=salary.id, confirmed=True, import_hash="hash-salary",
    ))
    db.commit()
    _make_sa(client, db)

    data = client.get("/dashboard/summary?month=2026-02").json()
    assert data["total_income_cents"] == 360000
    assert data["total_expenses_cents"] == 60000
    assert data["left_over_cents"] == 300000
    assert data["needs_wants_savings"]["wants_cents"] == 60000


def test_delete_keeps_materialised_rows(client, db):
    sa = _make_sa(client, db)
    client.get("/dashboard/summary?month=2026-02")
    r = client.delete(f"/standing-adjustments/{sa['id']}")
    assert r.status_code == 200
    assert db.get(StandingAdjustment, sa["id"]) is None
    orphans = db.query(Transaction).filter(
        Transaction.description == "Test allowance").all()
    assert len(orphans) == 2
    assert all(t.standing_adjustment_id is None for t in orphans)
