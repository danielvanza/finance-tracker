import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Category, Transaction
from seed import run_seed


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).first()


def _parent(db, amount, import_hash):
    tx = Transaction(
        date=date(2026, 3, 5), amount=Decimal(amount),
        description="split parent", source="ing",
        confirmed=False, import_hash=import_hash,
    )
    db.add(tx)
    db.commit()
    return tx


def test_mixed_refund_split_nets_against_prior_spend(client, db):
    """Acceptance case: -250 split into a food part and a misc refund part;
    the refund part nets the prior misc spend to zero on dashboard + budget."""
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    db.add(Transaction(
        date=date(2026, 3, 2), amount=Decimal("-125.00"),
        description="prior misc spend", source="ing",
        category_id=misc.id, confirmed=True,
        categorised_by="rule", import_hash="hash-prior-misc",
    ))
    db.commit()
    parent = _parent(db, "-250.00", "hash-split-parent-mixed")

    r = client.patch(f"/transactions/{parent.id}", json={
        "confirmed": True,
        "splits": [
            {"category_id": food.id, "amount_cents": -12500},
            {"category_id": misc.id, "amount_cents": -12500, "is_refund": True},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert [s["amount_cents"] for s in body["splits"]] == [-12500, -12500]
    assert [s["is_refund"] for s in body["splits"]] == [False, True]

    summary = client.get("/dashboard/summary", params={"month": "2026-03"}).json()
    by_name = {c["category_name"]: c["actual_cents"]
               for c in summary["category_breakdown"]}
    assert by_name["Food - Essential"] == 12500
    assert by_name["Miscellaneous"] == 0
    assert summary["total_expenses_cents"] == 12500

    budget = client.get("/budget", params={"month": "2026-03"}).json()
    actuals = {row["category_name"]: row["actual_amount_cents"] for row in budget}
    assert actuals["Food - Essential"] == 12500
    assert actuals["Miscellaneous"] == 0


def test_refund_part_on_income_category_rejected(client, db):
    food = _cat(db, "Food - Essential")
    salary = _cat(db, "Salary")
    parent = _parent(db, "-90.00", "hash-split-parent-income")

    r = client.patch(f"/transactions/{parent.id}", json={
        "splits": [
            {"category_id": food.id, "amount_cents": -6000},
            {"category_id": salary.id, "amount_cents": -3000, "is_refund": True},
        ],
    })
    assert r.status_code == 422
    assert "expense category" in r.json()["detail"]


def test_parent_flagged_refund_null_parts_inherit(client, db):
    """Parent +90 refund split with unflagged parts: NULL per-part flags
    inherit the parent's is_refund, surfaced as true on both parts."""
    food = _cat(db, "Food - Essential")
    misc = _cat(db, "Miscellaneous")
    parent = _parent(db, "90.00", "hash-split-parent-inherit")

    r = client.patch(f"/transactions/{parent.id}", json={
        "is_refund": True,
        "splits": [
            {"category_id": food.id, "amount_cents": 6000},
            {"category_id": misc.id, "amount_cents": 3000},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["is_refund"] is True
    assert [s["is_refund"] for s in body["splits"]] == [True, True]
