"""A shop is remembered for next time only when a person asks for it."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import guesses
from db import get_db
from main import app
from models import Category, Rule, Transaction
from seed import run_seed


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def waiting(db, name: str, cents: int = -1000, day: int = 1) -> Transaction:
    tx = Transaction(
        date=date(2026, 3, day), amount=Decimal(cents) / 100, description=name, source="ing",
        import_hash=f"{name}-{day}-{cents}", confirmed=False, categorised_by="ai", ai_options=[],
    )
    db.add(tx)
    db.commit()
    return tx


def category(db, name: str) -> Category:
    return db.query(Category).filter_by(name=name).one()


def test_an_answer_sorts_the_shops_waiting_payments_and_makes_no_rule(client, db):
    first, second = waiting(db, "Sample Bakery 12 Enschede NLD", day=1), waiting(db, "Sample Bakery 12 Enschede NLD", day=2)
    sorted_rows = guesses.answer(db, [first], category(db, "Food - Essential"))
    db.commit()
    assert {t.id for t in sorted_rows} == {first.id, second.id}
    assert first.confirmed and second.confirmed and second.category.name == "Food - Essential"
    assert db.query(Rule).filter(Rule.pattern.like("sample bakery%")).count() == 0

    # Asked for, the shop gets its rule; a second ask changes nothing more.
    assert [t.id for t in guesses.to_remember(db, sorted_rows)] == [first.id]
    rule = guesses.remember(db, first)
    db.commit()
    assert (rule.pattern, rule.category.name) == ("sample bakery", "Food - Essential")
    assert guesses.to_remember(db, sorted_rows) == []
    assert guesses.remember(db, second).id == rule.id
    assert db.query(Rule).filter_by(pattern="sample bakery").count() == 1


def test_nothing_is_offered_for_a_refund_or_a_payment_service(client, db):
    refund = waiting(db, "Sample Web Shop Returns", cents=2500)
    guesses.answer(db, [refund], category(db, "Clothing"))
    hidden = waiting(db, "Tikkie")
    guesses.answer(db, [hidden], category(db, "Miscellaneous"))
    db.commit()
    assert refund.is_refund and hidden.confirmed
    assert guesses.to_remember(db, [refund, hidden]) == []


def test_the_review_card_remembers_only_when_ticked(client, db):
    plain, ticked = waiting(db, "Sample Florist 3 Zwolle NLD"), waiting(db, "Sample Garage 4 Zwolle NLD")
    home = category(db, "Home & DIY").id
    assert client.patch(f"/transactions/{plain.id}", json={"category_id": home, "confirmed": True}).status_code == 200
    assert db.query(Rule).filter(Rule.pattern.like("sample florist%")).count() == 0
    assert client.patch(f"/transactions/{ticked.id}", json={"category_id": home, "confirmed": True, "remember": True}).status_code == 200
    assert [r.category_id for r in db.query(Rule).filter_by(pattern="sample garage")] == [home]
