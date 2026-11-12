"""A shop that sells a bit of everything is always asked about: never sorted by itself, never a rule."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import guesses
from categorizer.ai import Guess
from db import get_db
from main import app
from models import Category, Rule, Transaction
from seed import run_seed

SHOP = "MedikamenteDieGrenze ENSCHEDE"


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def payment(db, day: int, confirmed=False, category=None) -> Transaction:
    tx = Transaction(
        date=date(2026, 11, day), amount=Decimal("-12.50"), description=SHOP, source="ing",
        import_hash=f"{SHOP}-{day}", confirmed=confirmed, categorised_by="ai", ai_options=[] if confirmed else None,
        category_id=category.id if category else None,
    )
    db.add(tx)
    db.commit()
    return tx


def category(db, name: str) -> Category:
    return db.query(Category).filter_by(name=name).one()


def test_marking_a_shop_removes_its_rule_and_lists_it(client, db):
    first = payment(db, 1, confirmed=True, category=category(db, "Medical & Healthcare"))
    db.add(Rule(pattern="medikamentediegrenze", category_id=first.category_id))
    db.add(Rule(pattern="albert heijn", category_id=first.category_id))
    db.commit()

    r = client.post("/rules/ask-shops", json={"transaction_id": first.id})
    assert r.status_code == 200
    assert r.json() == {"pattern": "medikamentediegrenze enschede", "removed_rules": ["medikamentediegrenze"]}
    assert [rule.pattern for rule in db.query(Rule).all()] == ["albert heijn"]
    assert client.get("/rules/ask-shops").json() == [{"pattern": "medikamentediegrenze enschede"}]
    assert first.confirmed  # what was already sorted keeps its category

    assert client.delete("/rules/ask-shops", params={"pattern": "MedikamenteDieGrenze ENSCHEDE"}).status_code == 200
    assert client.get("/rules/ask-shops").json() == []


def test_a_sure_guess_waits_and_each_payment_is_asked_alone(client, db):
    medical, food = category(db, "Medical & Healthcare"), category(db, "Food - Essential")
    earlier = payment(db, 1, confirmed=True, category=food)
    guesses.always_ask(db, earlier)
    one, two = payment(db, 2), payment(db, 3)
    asked = guesses.ask_shops(db)
    for tx in (one, two):
        guesses.take_guess(tx, Guess(medical, True, [medical]), asked)
    db.commit()
    assert not one.confirmed and one.ai_options == [medical.id]

    groups = [g for g in guesses.groups(db) if g.pattern.startswith("medikamente")]
    assert sorted(g.only for g in groups) == [one.id, two.id]
    # Claude's guess first, then what the shop's earlier payments turned out to be.
    assert [o["category_id"] for o in guesses.options_for(db, groups[0])][:2] == [medical.id, food.id]

    # An answer settles that payment only, and nothing is offered to remember.
    sorted_rows = guesses.answer(db, [one], food)
    db.commit()
    assert [t.id for t in sorted_rows] == [one.id] and not two.confirmed
    assert guesses.to_remember(db, sorted_rows) == []
    assert guesses.remember(db, one) is None


def test_a_payment_service_is_no_shop_to_mark(client, db):
    tx = Transaction(date=date(2026, 11, 1), amount=Decimal("-5"), description="Tikkie", source="ing",
                     import_hash="tikkie", confirmed=False)
    db.add(tx)
    db.commit()
    assert client.post("/rules/ask-shops", json={"transaction_id": tx.id}).status_code == 422
