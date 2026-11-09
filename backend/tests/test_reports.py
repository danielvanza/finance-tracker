import json
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db import get_db
import models
from models import (
    Category, Rule, Setting, StandingAdjustment, Transaction, TransactionSplit,
    TransactionSource,
)
from routers.reports import router
from seed import run_seed


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)


def _cat(db, name):
    return db.query(Category).filter_by(name=name).one()


def _tx(db, amount, desc, cat, **kw):
    t = Transaction(date=kw.pop("date", date(2026, 10, 5)), amount=Decimal(amount), description=desc,
                    source=TransactionSource.ing, category_id=cat.id if cat else None,
                    import_hash=f"h-{desc}", confirmed=kw.pop("confirmed", True), **kw)
    db.add(t)
    db.flush()
    return t


def test_backup_is_a_json_download(client):
    r = client.get("/reports/backup")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.headers["content-disposition"].startswith('attachment; filename="finances-backup-')
    assert r.headers["content-disposition"].endswith('.json"')
    assert r.headers["cache-control"] == "no-store"


def test_backup_lists_every_household_table_in_cents(client, db):
    food = _cat(db, "Food - Essential")
    other = _cat(db, "Miscellaneous")
    parent = _tx(db, "-30.50", "Split shop", None, categorised_by=None, is_refund=False)
    db.add_all([
        TransactionSplit(transaction_id=parent.id, category_id=food.id, amount=Decimal("-20.25"), is_refund=None),
        TransactionSplit(transaction_id=parent.id, category_id=other.id, amount=Decimal("-10.25"), is_refund=False),
    ])
    _tx(db, "12.34", "Refund", food, is_refund=True, confirmed=False)
    db.add(Rule(pattern="albert", category_id=food.id, priority=3))
    db.add(StandingAdjustment(name="Allowance", amount=Decimal("600.00"), income_category_id=_cat(db, "Salary").id,
                              expense_category_id=other.id, start_month=date(2026, 1, 1)))
    db.commit()

    body = client.get("/reports/backup").json()

    assert body["app"] == "finances" and body["format"] == 1 and body["exported_at"]
    assert body["settings"]["financial_month_start_day"] == "24"
    assert {c["name"] for c in body["categories"]} == {c.name for c in db.query(Category).all()}
    assert any(b["month"] is None and b["planned_amount_cents"] > 0 for b in body["budgets"])
    assert [r["pattern"] for r in body["rules"]] == ["albert"]
    mine = next(a for a in body["standing_adjustments"] if a["name"] == "Allowance")
    assert mine["amount_cents"] == 60000
    assert mine["start_month"] == "2026-01-01"

    by_desc = {t["description"]: t for t in body["transactions"]}
    assert by_desc["Split shop"]["amount_cents"] == -3050
    assert [s["amount_cents"] for s in by_desc["Split shop"]["splits"]] == [-2025, -1025]
    assert by_desc["Refund"]["amount_cents"] == 1234
    assert by_desc["Refund"]["confirmed"] is False
    # A split part with no flag of its own follows the refund flag of the transaction.
    refund_parent = _tx(db, "5.00", "Refund split", None, is_refund=True)
    db.add(TransactionSplit(transaction_id=refund_parent.id, category_id=food.id, amount=Decimal("5.00"), is_refund=None))
    db.commit()
    again = {t["description"]: t for t in client.get("/reports/backup").json()["transactions"]}
    assert again["Refund split"]["splits"][0]["is_refund"] is True
    # No float money anywhere: every amount is an int.
    assert all(isinstance(t["amount_cents"], int) for t in body["transactions"])


def test_backup_leaves_the_chat_out_and_changes_nothing(client, db):
    ChatMessage = getattr(models, "ChatMessage", None)
    if ChatMessage is None:
        pytest.skip("the chat tables are not in this build")
    db.add(ChatMessage(channel="bubble", role="user", kind="text", text="secret chatter"))
    db.commit()
    before = (db.query(Transaction).count(), db.query(Setting).count(), db.query(ChatMessage).count())

    r = client.get("/reports/backup")

    assert "secret chatter" not in r.text
    assert set(r.json()) == {"app", "format", "exported_at", "settings", "categories", "budgets",
                             "rules", "standing_adjustments", "transactions"}
    assert (db.query(Transaction).count(), db.query(Setting).count(), db.query(ChatMessage).count()) == before


def test_backup_of_an_empty_household_is_valid_json(client, db):
    r = client.get("/reports/backup")
    body = json.loads(r.text)
    assert body["transactions"] == [] and body["rules"] == []
