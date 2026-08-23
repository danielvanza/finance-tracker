"""Category-type change guard (S1): PATCH /categories/{id} must refuse type
changes on categories that are still referenced, unless force:true."""

import pytest
from datetime import date
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed
from models import Category, CategoryType, Transaction, TransactionSplit, Rule, StandingAdjustment


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).first()


def _fresh_cat(client, db, name="Guard Target", type_="wants"):
    r = client.post("/categories", json={"name": name, "type": type_})
    assert r.status_code == 201, r.text
    return _cat(db, name)


def test_type_change_blocked_by_rule(client, db):
    cat = _fresh_cat(client, db)
    db.add(Rule(pattern="guard-target", category_id=cat.id, priority=0))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs"})

    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "Cannot change type of 'Guard Target' to 'needs'" in detail
    assert "1 rule(s)" in detail
    db.refresh(cat)
    assert cat.type == CategoryType.wants


def test_type_change_blocked_by_transaction(client, db):
    cat = _fresh_cat(client, db)
    db.add(Transaction(
        date=date(2026, 1, 1), amount=-10, description="x", source="manual",
        category_id=cat.id, confirmed=True, import_hash="guard-t1",
    ))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs"})

    assert r.status_code == 422
    assert "1 transaction(s)" in r.json()["detail"]
    db.refresh(cat)
    assert cat.type == CategoryType.wants


def test_type_change_blocked_by_split(client, db):
    cat = _fresh_cat(client, db)
    food = _cat(db, "Food - Essential")
    txn = Transaction(
        date=date(2026, 1, 1), amount=-10, description="x", source="manual",
        category_id=food.id, confirmed=True, import_hash="guard-t2",
    )
    db.add(txn)
    db.flush()
    db.add(TransactionSplit(transaction_id=txn.id, category_id=cat.id, amount=5))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs"})

    assert r.status_code == 422
    assert "1 split(s)" in r.json()["detail"]
    db.refresh(cat)
    assert cat.type == CategoryType.wants


def test_type_change_blocked_by_standing_adjustment(client, db):
    cat = _fresh_cat(client, db)
    salary = _cat(db, "Salary")
    db.add(StandingAdjustment(
        name="Guard allowance", amount=600,
        income_category_id=salary.id, expense_category_id=cat.id,
        active=True, start_month=date(2026, 1, 1),
    ))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs"})

    assert r.status_code == 422
    assert "1 standing adjustment(s)" in r.json()["detail"]
    db.refresh(cat)
    assert cat.type == CategoryType.wants


def test_type_change_force_overrides_and_keeps_dependents(client, db):
    cat = _fresh_cat(client, db)
    db.add(Rule(pattern="guard-target", category_id=cat.id, priority=0))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs", "force": True})

    assert r.status_code == 200
    assert r.json()["type"] == "needs"
    db.refresh(cat)
    assert cat.type == CategoryType.needs
    rule = db.query(Rule).filter_by(category_id=cat.id).one()
    assert rule.pattern == "guard-target"


def test_type_change_without_dependents_needs_no_force(client, db):
    cat = _fresh_cat(client, db)

    r = client.patch(f"/categories/{cat.id}", json={"type": "needs"})

    assert r.status_code == 200
    assert r.json()["type"] == "needs"
    db.refresh(cat)
    assert cat.type == CategoryType.needs


def test_rename_only_bypasses_guard_on_used_category(client, db):
    cat = _cat(db, "Food - Essential")
    db.add(Transaction(
        date=date(2026, 1, 1), amount=-10, description="x", source="manual",
        category_id=cat.id, confirmed=True, import_hash="guard-t3",
    ))
    db.add(Rule(pattern="albert heijn", category_id=cat.id, priority=0))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"name": "Groceries"})

    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Groceries"
    assert body["type"] == "needs"
    db.refresh(cat)
    assert cat.type == CategoryType.needs


def test_invalid_type_on_used_category_is_parse_error_not_census(client, db):
    cat = _fresh_cat(client, db)
    db.add(Rule(pattern="guard-target", category_id=cat.id, priority=0))
    db.commit()

    r = client.patch(f"/categories/{cat.id}", json={"type": "bogus"})

    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail == "Invalid type: bogus"
    assert "Cannot change type of" not in detail
    db.refresh(cat)
    assert cat.type == CategoryType.wants
