import pytest
from datetime import date
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed
from models import Category, Budget, Transaction, TransactionSplit, Rule, StandingAdjustment


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).first()


def test_create_category_succeeds(client, db):
    r = client.post("/categories", json={"name": "Pet Care", "type": "wants"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Pet Care"
    assert body["type"] == "wants"

    names = {c["name"] for c in client.get("/categories").json()}
    assert "Pet Care" in names


def test_create_category_duplicate_name_422(client):
    client.post("/categories", json={"name": "Pet Care", "type": "wants"})
    r = client.post("/categories", json={"name": "Pet Care", "type": "needs"})
    assert r.status_code == 422


def test_create_category_invalid_type_422(client):
    r = client.post("/categories", json={"name": "Pet Care", "type": "bogus"})
    assert r.status_code == 422


def test_create_category_blank_name_422(client):
    r = client.post("/categories", json={"name": "   ", "type": "wants"})
    assert r.status_code == 422


def test_create_expense_category_gets_default_budget(client, db):
    r = client.post("/categories", json={"name": "Pet Care", "type": "wants"})
    cat_id = r.json()["id"]
    budget = db.query(Budget).filter_by(category_id=cat_id, month=None).first()
    assert budget is not None
    assert budget.planned_amount == 0


def test_create_income_category_gets_no_default_budget(client, db):
    r = client.post("/categories", json={"name": "Bonus", "type": "income"})
    cat_id = r.json()["id"]
    budget = db.query(Budget).filter_by(category_id=cat_id, month=None).first()
    assert budget is None


def test_rename_category(client, db):
    cat = _cat(db, "Fun Account")
    r = client.patch(f"/categories/{cat.id}", json={"name": "Dog savings"})
    assert r.status_code == 200
    assert r.json()["name"] == "Dog savings"

    names = {c["name"] for c in client.get("/categories").json()}
    assert "Dog savings" in names
    assert "Fun Account" not in names


def test_rename_category_duplicate_name_422(client, db):
    a = _cat(db, "Fun Account")
    b = _cat(db, "DEGIRO")
    r = client.patch(f"/categories/{a.id}", json={"name": b.name})
    assert r.status_code == 422


def test_rename_only_name_leaves_type_unaffected(client, db):
    cat = _cat(db, "Fun Account")
    r = client.patch(f"/categories/{cat.id}", json={"name": "Dog savings"})
    assert r.json()["type"] == "savings"


def test_delete_unused_category(client, db):
    r = client.post("/categories", json={"name": "Pet Care", "type": "wants"})
    cat_id = r.json()["id"]
    r = client.delete(f"/categories/{cat_id}")
    assert r.status_code == 200
    assert db.get(Category, cat_id) is None
    assert db.query(Budget).filter_by(category_id=cat_id).first() is None


def test_delete_blocked_by_transaction(client, db):
    cat = _cat(db, "Fun Account")
    db.add(Transaction(
        date=date(2026, 1, 1), amount=10, description="x", source="manual",
        category_id=cat.id, confirmed=True, import_hash="h1",
    ))
    db.commit()
    r = client.delete(f"/categories/{cat.id}")
    assert r.status_code == 422
    assert db.get(Category, cat.id) is not None


def test_delete_blocked_by_split(client, db):
    cat = _cat(db, "Fun Account")
    other = _cat(db, "DEGIRO")
    txn = Transaction(
        date=date(2026, 1, 1), amount=10, description="x", source="manual",
        category_id=other.id, confirmed=True, import_hash="h2",
    )
    db.add(txn)
    db.flush()
    db.add(TransactionSplit(transaction_id=txn.id, category_id=cat.id, amount=5))
    db.commit()
    r = client.delete(f"/categories/{cat.id}")
    assert r.status_code == 422
    assert db.get(Category, cat.id) is not None


def test_delete_blocked_by_rule(client, db):
    cat = _cat(db, "Fun Account")
    db.add(Rule(pattern="petshop", category_id=cat.id, priority=0))
    db.commit()
    r = client.delete(f"/categories/{cat.id}")
    assert r.status_code == 422
    assert db.get(Category, cat.id) is not None


def test_delete_blocked_by_standing_adjustment(client, db):
    retained = _cat(db, "Retained Salary")
    allowance = _cat(db, "Personal Allowance")
    db.add(StandingAdjustment(
        name="Test allowance", amount=600,
        income_category_id=retained.id, expense_category_id=allowance.id,
        active=True, start_month=date(2026, 1, 1),
    ))
    db.commit()
    r = client.delete(f"/categories/{allowance.id}")
    assert r.status_code == 422
    assert db.get(Category, allowance.id) is not None


def test_delete_nonexistent_category_404(client):
    r = client.delete("/categories/999999")
    assert r.status_code == 404


def test_reorder_swaps_two_categories(client, db):
    a = _cat(db, "Fun Account")
    b = _cat(db, "DEGIRO")
    a_order, b_order = a.sort_order, b.sort_order
    others = [c.sort_order for c in db.query(Category).all() if c.id not in (a.id, b.id)]

    r = client.patch("/categories/reorder", json={"category_ids": [a.id, b.id]})
    assert r.status_code == 200

    db.refresh(a)
    db.refresh(b)
    assert {a.sort_order, b.sort_order} == {a_order, b_order}
    assert a.sort_order == min(a_order, b_order)
    assert b.sort_order == max(a_order, b_order)

    remaining = [c.sort_order for c in db.query(Category).all() if c.id not in (a.id, b.id)]
    assert remaining == others


def test_reorder_unknown_id_422(client, db):
    a = _cat(db, "Fun Account")
    r = client.patch("/categories/reorder", json={"category_ids": [a.id, 999999]})
    assert r.status_code == 422
