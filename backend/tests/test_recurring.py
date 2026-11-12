from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db import get_db
from models import Category, Transaction
from routers import recurring as recurring_router
from seed import run_seed

TODAY = date(2026, 11, 9)  # financial month 2026-11: 24 Oct - 23 Nov


@pytest.fixture
def ctx(db, monkeypatch):
    run_seed(db)
    monkeypatch.setattr(recurring_router, "_today", lambda: TODAY)
    app = FastAPI()
    app.include_router(recurring_router.router)
    app.dependency_overrides[get_db] = lambda: db
    return db, TestClient(app)


def _add(db, when, euros, desc, category="Utilities", source="ing", **kw):
    cat = db.query(Category).filter_by(name=category).one()
    db.add(Transaction(
        date=when, amount=Decimal(str(euros)), description=desc, source=source,
        category_id=cat.id, confirmed=kw.pop("confirmed", True),
        import_hash=f"{desc}-{when}-{euros}-{source}-{kw.get('is_refund', '')}", **kw,
    ))
    db.commit()


def _monthly(db, desc, euros, days, **kw):
    for d in days:
        _add(db, d, euros, desc, **kw)


def _get(client, month=None):
    return client.get("/recurring", params={"month": month} if month else None).json()


def _by_key(body):
    return {i["key"]: i for i in body["items"]}


def _files_to_today(db):
    """A bank file that reaches yesterday, so nothing is called 'behind'."""
    _add(db, TODAY - timedelta(days=1), -3, "Bakker", "Food - Essential")


def test_monthly_payment_not_yet_this_month_is_due(ctx):
    db, client = ctx
    _monthly(db, "Ziggo internet", -45, [date(2026, 8, 12), date(2026, 9, 12), date(2026, 10, 12)])
    _files_to_today(db)
    body = _get(client)
    ziggo = _by_key(body)["ziggo internet"]
    assert (ziggo["state"], ziggo["cadence"], ziggo["amount_cents"]) == ("due", "monthly", 4500)
    assert (ziggo["last_date"], ziggo["next_date"]) == ("2026-10-12", "2026-11-12")
    assert [h["date"] for h in ziggo["history"]] == ["2026-10-12", "2026-09-12", "2026-08-12"]
    assert body["due_cents"] == 4500
    assert body["status"] == "ok"


def test_paid_this_month_and_the_next_date(ctx):
    db, client = ctx
    _monthly(db, "Hypotheek ING", -1850, [date(2026, 8, 26), date(2026, 9, 26), date(2026, 10, 26)])
    _files_to_today(db)
    mortgage = _by_key(_get(client))["hypotheek ing"]
    assert (mortgage["state"], mortgage["next_date"]) == ("paid", "2026-11-26")
    assert mortgage["category_type"] == "needs"


def test_price_rise_is_flagged_and_the_new_price_is_the_amount(ctx):
    db, client = ctx
    for d, c in [(date(2026, 8, 1), -17.99), (date(2026, 9, 1), -17.99), (date(2026, 10, 1), -17.99), (date(2026, 11, 1), -19.99)]:
        _add(db, d, c, "Netflix", "Recreation & Entertainment", source="ing")
    _files_to_today(db)
    netflix = _by_key(_get(client))["netflix"]
    assert netflix["state"] == "paid"
    assert netflix["amount_cents"] == 1999
    assert netflix["price_change"] == {"from_cents": 1799, "to_cents": 1999}


def test_a_price_fall_or_a_steady_price_has_no_chip(ctx):
    db, client = ctx
    for d, c in [(date(2026, 8, 3), -12.99), (date(2026, 9, 3), -12.99), (date(2026, 10, 3), -10.99)]:
        _add(db, d, c, "Spotify", "Recreation & Entertainment")
    _files_to_today(db)
    assert _by_key(_get(client))["spotify"]["price_change"] is None


def test_variable_energy_bill_is_found_without_a_price_chip(ctx):
    db, client = ctx
    for d, c in [(date(2026, 7, 27), -92.5), (date(2026, 8, 27), -101.2), (date(2026, 9, 27), -88.4), (date(2026, 10, 27), -110.0)]:
        _add(db, d, c, "Vattenfall energie")
    _files_to_today(db)
    energy = _by_key(_get(client))["vattenfall energie"]
    assert energy["price_change"] is None
    assert energy["state"] == "paid"


def test_stopped_only_when_bank_files_reach_well_past_it(ctx):
    db, client = ctx
    _monthly(db, "Disney Plus", -11.99, [date(2026, 6, 28), date(2026, 7, 28), date(2026, 8, 28)])
    _files_to_today(db)
    disney = _by_key(_get(client))["disney plus"]
    assert disney["state"] == "stopped"
    assert disney["next_date"] is None
    assert _get(client)["due_cents"] == 0


def test_a_missed_payment_is_not_stopped_yet(ctx):
    db, client = ctx
    _monthly(db, "Disney Plus", -11.99, [date(2026, 7, 28), date(2026, 8, 28), date(2026, 9, 28)])
    _files_to_today(db)
    disney = _by_key(_get(client))["disney plus"]
    assert disney["state"] == "due"  # the files reach past 28 Oct and show nothing
    assert disney["next_date"] == "2026-10-28"


def test_behind_bank_files_say_expected_never_missed(ctx):
    db, client = ctx
    _monthly(db, "Netflix", -17.99, [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)])
    _monthly(db, "Ziggo internet", -45, [date(2026, 7, 12), date(2026, 8, 12), date(2026, 9, 12), date(2026, 10, 12)])
    _add(db, date(2026, 10, 28), -134, "Zilveren Kruis", "Insurance")
    body = _get(client)
    states = {k: v["state"] for k, v in _by_key(body).items()}
    assert states == {"netflix": "expected", "ziggo internet": "expected"}
    assert body["status"] == "gap"
    assert body["data_through"] == "2026-10-28"
    assert (body["due_cents"], body["expected_cents"]) == (0, 6299)


def test_a_payment_in_the_gap_that_the_files_do_cover_is_due(ctx):
    db, client = ctx
    # Files reach 28 Oct; the 26 Oct mortgage is inside them and is paid, nothing is guessed after that.
    _monthly(db, "Hypotheek ING", -1850, [date(2026, 7, 26), date(2026, 8, 26), date(2026, 9, 26), date(2026, 10, 26)])
    _add(db, date(2026, 10, 28), -3, "Bakker", "Food - Essential")
    body = _get(client)
    assert _by_key(body)["hypotheek ing"]["state"] == "paid"


def test_nothing_repeating_gives_an_empty_answer(ctx):
    db, client = ctx
    for i, d in enumerate([date(2026, 10, 2), date(2026, 10, 5), date(2026, 10, 19)]):
        _add(db, d, -20 - i, "Albert Heijn Amsterdam", "Food - Essential")
    body = _get(client)
    assert body["items"] == []
    assert body["status"] == "none"
    assert body["due_cents"] == 0


def test_two_payments_are_not_enough_and_irregular_gaps_are_not_a_cadence(ctx):
    db, client = ctx
    _monthly(db, "Gym", -30, [date(2026, 9, 15), date(2026, 10, 15)])
    _monthly(db, "Hema", -30, [date(2026, 8, 3), date(2026, 9, 9), date(2026, 10, 30)])
    assert _get(client)["items"] == []


def test_refunds_unconfirmed_and_income_are_skipped(ctx):
    db, client = ctx
    days = [date(2026, 8, 5), date(2026, 9, 5), date(2026, 10, 5)]
    _monthly(db, "Refunder", 20, days, is_refund=True)
    _monthly(db, "Maybe", -20, days, confirmed=False)
    _monthly(db, "Salary ACME", 4200, days, category="Salary")
    assert _get(client)["items"] == []


def test_exclude_type_categories_are_skipped(ctx):
    db, client = ctx
    excluded = db.query(Category).filter(Category.type == "exclude").first()
    assert excluded is not None
    _monthly(db, "Own account", -300, [date(2026, 8, 5), date(2026, 9, 5), date(2026, 10, 5)], category=excluded.name)
    assert _get(client)["items"] == []


def test_weekly_cadence_counts_each_remaining_payment(ctx):
    db, client = ctx
    # Every Thursday; the last seen is 5 Nov, so 12 and 19 Nov are still to come.
    _monthly(db, "Marktkraam", -10, [date(2026, 10, 15), date(2026, 10, 22), date(2026, 10, 29), date(2026, 11, 5)])
    _files_to_today(db)
    stall = _by_key(_get(client))["marktkraam"]
    assert (stall["cadence"], stall["remaining"], stall["state"]) == ("weekly", 2, "due")
    assert _get(client)["due_cents"] == 2000


def test_weekly_visits_that_cost_different_amounts_are_not_a_payment(ctx):
    db, client = ctx
    for d, c in [(date(2026, 10, 15), -14.5), (date(2026, 10, 21), -15.5), (date(2026, 10, 29), -13.3)]:
        _add(db, d, c, "Pathe Bioscoop", "Recreation & Entertainment")
    assert _get(client)["items"] == []


def test_quarterly_payment_outside_the_month_is_later(ctx):
    db, client = ctx
    _monthly(db, "Gemeente belasting", -240, [date(2026, 1, 20), date(2026, 4, 20), date(2026, 7, 20), date(2026, 10, 20)])
    _files_to_today(db)
    tax = _by_key(_get(client))["gemeente belasting"]
    assert (tax["cadence"], tax["state"], tax["next_date"]) == ("quarterly", "later", "2027-01-20")


def test_past_month_is_read_as_it_was_at_its_end(ctx):
    db, client = ctx
    _monthly(db, "Ziggo internet", -45, [date(2026, 7, 12), date(2026, 8, 12), date(2026, 9, 12), date(2026, 10, 12)])
    _monthly(db, "Netflix", -17.99, [date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1)])
    _add(db, date(2026, 10, 20), -3, "Bakker", "Food - Essential")
    body = _get(client, "2026-10")  # 24 Sep - 23 Oct
    assert (body["start_date"], body["end_date"]) == ("2026-09-24", "2026-10-23")
    assert _by_key(body)["ziggo internet"]["state"] == "paid"
    assert "2026-10-12" == _by_key(body)["ziggo internet"]["last_date"]


def test_bad_month_is_rejected(ctx):
    _, client = ctx
    assert client.get("/recurring", params={"month": "nonsense"}).status_code == 422


def test_money_is_integer_cents(ctx):
    db, client = ctx
    _monthly(db, "Basic-Fit abonnement", -29.99, [date(2026, 8, 15), date(2026, 9, 15), date(2026, 10, 15)])
    _files_to_today(db)
    body = _get(client)
    for value in [body["due_cents"], body["expected_cents"], *[i["amount_cents"] for i in body["items"]]]:
        assert isinstance(value, int)
    assert body["items"][0]["amount_cents"] == 2999
