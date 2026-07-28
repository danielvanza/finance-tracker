import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Transaction, TransactionSplit, Category
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
            description="tx", import_hash=None):
    tx = Transaction(
        date=date(2026, 3, 1), amount=Decimal(amount), description=description,
        source="ing", category_id=category.id if category else None,
        confirmed=confirmed, is_refund=is_refund,
        import_hash=import_hash or f"hash-{amount}-{description}",
    )
    db.add(tx)
    db.commit()
    return tx


def test_split_transaction(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    r = client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-125.00"},
        {"category_id": misc.id, "amount": "-125.00"},
    ], "confirmed": True})
    assert r.status_code == 200
    body = r.json()
    assert body["category_id"] is None
    assert len(body["splits"]) == 2
    assert {s["category_name"] for s in body["splits"]} == {"Food - Essential", "Miscellaneous"}


def test_split_must_sum_to_parent(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    r = client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-125.00"},
        {"category_id": misc.id, "amount": "-100.00"},
    ]})
    assert r.status_code == 422
    assert "sum" in r.json()["detail"].lower()


def test_split_rejects_single_part_mixed_sign_and_zero(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    r = client.patch(f"/transactions/{tx.id}",
                     json={"splits": [{"category_id": food.id, "amount": "-250.00"}]})
    assert r.status_code == 422
    r = client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-375.00"},
        {"category_id": misc.id, "amount": "125.00"},
    ]})
    assert r.status_code == 422
    r = client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-250.00"},
        {"category_id": misc.id, "amount": "0"},
    ]})
    assert r.status_code == 422


def test_unsplit_restores_single_category(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-125.00"},
        {"category_id": misc.id, "amount": "-125.00"},
    ]})
    r = client.patch(f"/transactions/{tx.id}",
                     json={"splits": [], "category_id": food.id})
    assert r.status_code == 200
    body = r.json()
    assert body["splits"] == []
    assert body["category_id"] == food.id
    assert db.query(TransactionSplit).count() == 0


def test_aggregates_read_parts_not_parent(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-125.00"},
        {"category_id": misc.id, "amount": "-125.00"},
    ], "confirmed": True})

    data = client.get("/dashboard/summary?month=2026-03").json()
    assert data["total_expenses"] == 250.0  # no double counting, nothing lost
    food_row = next(d for d in data["category_breakdown"] if d["category_id"] == food.id)
    misc_row = next(d for d in data["category_breakdown"] if d["category_id"] == misc.id)
    assert food_row["actual"] == 125.0
    assert misc_row["actual"] == 125.0
    assert data["needs_wants_savings"]["needs"] == 125.0
    assert data["needs_wants_savings"]["wants"] == 125.0

    budget_rows = client.get("/budget?month=2026-03").json()
    food_budget = next(r for r in budget_rows if r["category_id"] == food.id)
    assert Decimal(str(food_budget["actual_amount"])) == Decimal("125.00")


def test_filter_by_category_matches_split_parts(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    tx = _add_tx(db, "-250.00")
    client.patch(f"/transactions/{tx.id}", json={"splits": [
        {"category_id": food.id, "amount": "-125.00"},
        {"category_id": misc.id, "amount": "-125.00"},
    ]})
    r = client.get(f"/transactions?category_id={food.id}")
    assert [t["id"] for t in r.json()] == [tx.id]


def test_split_refund_reduces_both_categories(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    _add_tx(db, "-200.00", category=food, description="groceries")
    _add_tx(db, "-100.00", category=misc, description="stuff")
    refund = _add_tx(db, "90.00", description="combined refund")
    r = client.patch(f"/transactions/{refund.id}", json={
        "is_refund": True, "confirmed": True,
        "splits": [
            {"category_id": food.id, "amount": "60.00"},
            {"category_id": misc.id, "amount": "30.00"},
        ],
    })
    assert r.status_code == 200

    data = client.get("/dashboard/summary?month=2026-03").json()
    food_row = next(d for d in data["category_breakdown"] if d["category_id"] == food.id)
    misc_row = next(d for d in data["category_breakdown"] if d["category_id"] == misc.id)
    assert food_row["actual"] == 140.0
    assert misc_row["actual"] == 70.0
    assert data["total_income"] == 0.0


def test_refund_split_rejects_income_category_part(client, db):
    food = _cat(db, "Food - Essential")
    salary = _cat(db, "Salary")
    refund = _add_tx(db, "90.00", description="combined refund")
    r = client.patch(f"/transactions/{refund.id}", json={
        "is_refund": True,
        "splits": [
            {"category_id": food.id, "amount": "60.00"},
            {"category_id": salary.id, "amount": "30.00"},
        ],
    })
    assert r.status_code == 422


def test_deleting_split_parent_removes_parts(client, db):
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    created = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "-50.00",
        "description": "manual mixed basket", "category_id": food.id,
    }).json()
    client.patch(f"/transactions/{created['id']}", json={"splits": [
        {"category_id": food.id, "amount": "-30.00"},
        {"category_id": misc.id, "amount": "-20.00"},
    ]})
    assert db.query(TransactionSplit).count() == 2
    r = client.delete(f"/transactions/{created['id']}")
    assert r.status_code == 200
    assert db.query(TransactionSplit).count() == 0
