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


def test_create_manual_transaction(client, db):
    food = _cat(db, "Food - Essential")
    r = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "-25.50",
        "description": "Cash groceries", "category_id": food.id,
    })
    assert r.status_code == 201
    body = r.json()
    assert body["source"] == "manual"
    assert body["confirmed"] is True
    assert body["categorised_by"] == "manual"
    tx = db.get(Transaction, body["id"])
    assert tx.import_hash  # synthetic hash still satisfies NOT NULL + unique


def test_manual_transaction_skips_review_queue(client, db):
    food = _cat(db, "Food - Essential")
    client.post("/transactions", json={
        "date": "2026-03-05", "amount": "-25.50",
        "description": "Cash groceries", "category_id": food.id,
    })
    r = client.get("/transactions/review")
    assert r.json() is None


def test_create_manual_rejects_zero_amount_and_bad_category(client, db):
    food = _cat(db, "Food - Essential")
    r = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "0",
        "description": "nothing", "category_id": food.id,
    })
    assert r.status_code == 422
    r = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "-10.00",
        "description": "ghost", "category_id": 99999,
    })
    assert r.status_code == 422


def test_create_manual_refund(client, db):
    food = _cat(db, "Food - Essential")
    r = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "30.00",
        "description": "return", "category_id": food.id, "is_refund": True,
    })
    assert r.status_code == 201
    assert r.json()["is_refund"] is True


def test_delete_manual_but_not_imported(client, db):
    food = _cat(db, "Food - Essential")
    created = client.post("/transactions", json={
        "date": "2026-03-05", "amount": "-25.50",
        "description": "Cash groceries", "category_id": food.id,
    }).json()
    imported = Transaction(
        date=date(2026, 3, 1), amount=Decimal("-45.00"),
        description="Albert Heijn", source="ing",
        category_id=food.id, confirmed=True, import_hash="hash-imported",
    )
    db.add(imported)
    db.commit()

    r = client.delete(f"/transactions/{created['id']}")
    assert r.status_code == 200
    assert db.get(Transaction, created["id"]) is None

    r = client.delete(f"/transactions/{imported.id}")
    assert r.status_code == 422
    assert db.get(Transaction, imported.id) is not None

