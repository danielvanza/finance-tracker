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
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).first()


def _add_tx(db, amount, category=None, confirmed=True, is_refund=False,
            tx_date=date(2026, 3, 1), description="tx", import_hash=None):
    tx = Transaction(
        date=tx_date, amount=Decimal(amount), description=description,
        source="ing", category_id=category.id if category else None,
        confirmed=confirmed, is_refund=is_refund,
        import_hash=import_hash or f"hash-{amount}-{description}",
    )
    db.add(tx)
    db.commit()
    return tx


def test_mark_positive_as_refund_of_expense_category(client, db):
    food = _cat(db, "Food - Essential")
    tx = _add_tx(db, "150.00", confirmed=False)
    r = client.patch(f"/transactions/{tx.id}",
                     json={"category_id": food.id, "is_refund": True, "confirmed": True})
    assert r.status_code == 200
    body = r.json()
    assert body["is_refund"] is True
    assert body["category_id"] == food.id


def test_refund_rejected_for_negative_amount(client, db):
    food = _cat(db, "Food - Essential")
    tx = _add_tx(db, "-150.00", confirmed=False)
    r = client.patch(f"/transactions/{tx.id}",
                     json={"category_id": food.id, "is_refund": True})
    assert r.status_code == 422


def test_refund_rejected_for_income_category(client, db):
    salary = _cat(db, "Salary")
    tx = _add_tx(db, "150.00", confirmed=False)
    r = client.patch(f"/transactions/{tx.id}",
                     json={"category_id": salary.id, "is_refund": True})
    assert r.status_code == 422


def test_refund_nets_against_category_and_stays_out_of_income(client, db):
    food = _cat(db, "Food - Essential")
    salary = _cat(db, "Salary")
    _add_tx(db, "-300.00", category=food, description="groceries")
    _add_tx(db, "150.00", category=food, is_refund=True, description="reimbursement")
    _add_tx(db, "1000.00", category=salary, description="salary")

    r = client.get("/dashboard/summary?month=2026-03")
    data = r.json()
    assert data["total_income"] == 1000.0
    assert data["total_expenses"] == 150.0
    assert data["left_over"] == 850.0
    food_row = next(d for d in data["category_breakdown"] if d["category_id"] == food.id)
    assert food_row["actual"] == 150.0
    # Refund must not appear as income of any category
    assert all(row["category_id"] != food.id for row in data["income_breakdown"])
    assert data["needs_wants_savings"]["needs"] == 150.0


def test_over_refunded_category_goes_negative(client, db):
    food = _cat(db, "Food - Essential")
    _add_tx(db, "-100.00", category=food, description="groceries")
    _add_tx(db, "150.00", category=food, is_refund=True, description="big refund")

    r = client.get("/budget?month=2026-03")
    food_row = next(row for row in r.json() if row["category_id"] == food.id)
    assert Decimal(str(food_row["actual_amount"])) == Decimal("-50.00")


def test_budget_actuals_net_refunds(client, db):
    food = _cat(db, "Food - Essential")
    _add_tx(db, "-300.00", category=food, description="groceries")
    _add_tx(db, "150.00", category=food, is_refund=True, description="reimbursement")

    r = client.get("/budget?month=2026-03")
    food_row = next(row for row in r.json() if row["category_id"] == food.id)
    assert Decimal(str(food_row["actual_amount"])) == Decimal("150.00")


def test_salary_and_transfers_unaffected(client, db):
    salary = _cat(db, "Salary")
    transfer = _cat(db, "Internal Transfer")
    _add_tx(db, "3000.00", category=salary, description="salary")
    _add_tx(db, "-500.00", category=transfer, description="to savings account")
    _add_tx(db, "500.00", category=transfer, description="from savings account")

    r = client.get("/dashboard/summary?month=2026-03")
    data = r.json()
    assert data["total_income"] == 3000.0
    assert data["total_expenses"] == 0.0


def test_monthly_trend_nets_refunds(client, db):
    food = _cat(db, "Food - Essential")
    _add_tx(db, "-300.00", category=food, description="groceries")
    _add_tx(db, "120.00", category=food, is_refund=True, description="reimbursement")

    r = client.get("/dashboard/summary?month=2026-03")
    trend = r.json()["monthly_trend"]
    march = next(t for t in trend if t["month"] == "2026-03")
    assert march["total"] == 180.0


def test_create_rule_skips_refund_marked_transactions(client, db):
    food = _cat(db, "Food - Essential")
    confirmed_tx = _add_tx(db, "-45.00", category=food, description="Albert Heijn")
    refund_tx = _add_tx(db, "20.00", confirmed=False, is_refund=True,
                        description="Albert Heijn statiegeld")
    r = client.post(f"/transactions/{confirmed_tx.id}/create-rule")
    assert r.status_code == 200
    db.refresh(refund_tx)
    assert refund_tx.confirmed is False
    assert refund_tx.category_id is None
