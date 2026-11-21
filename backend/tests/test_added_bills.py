"""Fixed bills added by hand, and a person's new amount or day for a bill found from payments."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import clock
import db as database
from assistant import actions, queries
from db import Base, get_db
from models import AddedBill, BillChange, Category, Transaction
from routers import recurring as recurring_router
from seed import run_seed

TODAY = date(2026, 11, 9)  # financial month 2026-11: 24 Oct - 23 Nov


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    """A file database the chat's own sessions (preview, apply, lookups) reach too, on TODAY."""
    engine = create_engine(f"sqlite:///{tmp_path / 'finance.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(queries, "SessionLocal", Session)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 9, 12, 0))
    db = Session()
    run_seed(db)
    app = FastAPI()
    app.include_router(recurring_router.router)
    app.dependency_overrides[get_db] = lambda: db
    _add(db, TODAY - timedelta(days=1), -3, "Bakker", "Food - Essential")  # bank files reach yesterday
    yield db, TestClient(app)
    db.close()
    engine.dispose()


def _add(db, when, euros, desc, category="Utilities", confirmed=True):
    cat = db.query(Category).filter_by(name=category).one()
    db.add(Transaction(
        date=when, amount=Decimal(str(euros)), description=desc, source="ing", category_id=cat.id,
        confirmed=confirmed, import_hash=f"{desc}-{when}-{euros}",
    ))
    db.commit()


def _ziggo(db):
    for d in (date(2026, 8, 12), date(2026, 9, 12), date(2026, 10, 12)):
        _add(db, d, -45, "Ziggo internet")


def _items(client):
    body = client.get("/recurring").json()
    return body, {i["key"]: i for i in body["items"]}


def _category_id(db, name):
    return db.query(Category).filter_by(name=name).one().id


def _gym(client, **kw):
    body = {"name": "Sportschool", "amount_cents": 4000, "day": 15, "starts": "2026-11", **kw}
    response = client.post("/recurring/bills", json=body)
    assert response.status_code == 200, response.text
    return response.json()["key"]


# ---- The scan ------------------------------------------------------------------------------------

def test_an_added_bill_is_due_until_its_payment_comes(ctx):
    db, client = ctx
    key = _gym(client)
    body, items = _items(client)
    gym = items[key]
    assert (gym["state"], gym["next_date"], gym["remaining"], gym["amount_cents"]) == ("due", "2026-11-15", 1, 4000)
    assert gym["added"] is True and gym["cadence"] == "monthly" and gym["last_date"] is None
    assert body["due_cents"] == 4000

    _add(db, date(2026, 11, 8), -40, "SEPA Sportschool Fit BV")  # a week early still settles it
    body, items = _items(client)
    assert items[key]["state"] == "paid" and items[key]["last_date"] == "2026-11-08"
    assert body["due_cents"] == 0


def test_a_payment_far_from_the_date_or_waiting_for_an_answer_does_not_settle_it(ctx):
    db, client = ctx
    key = _gym(client)
    _add(db, date(2026, 10, 25), -40, "Sportschool")  # 21 days before
    _add(db, date(2026, 11, 8), -40, "Sportschool extra", confirmed=False)
    assert _items(client)[1][key]["state"] == "due"


def test_without_a_first_month_a_day_already_past_is_not_counted(ctx):
    db, client = ctx
    past = client.post("/recurring/bills", json={"name": "Gym", "amount_cents": 3000, "day": 5}).json()["key"]
    coming = client.post("/recurring/bills", json={"name": "Bike", "amount_cents": 1500, "day": 20}).json()["key"]
    items = _items(client)[1]
    assert (items[past]["state"], items[past]["next_date"]) == ("later", "2026-12-05")
    assert (items[coming]["state"], items[coming]["next_date"]) == ("due", "2026-11-20")


def test_a_quarterly_added_bill_counts_only_in_the_months_it_is_due(ctx):
    db, client = ctx
    key = _gym(client, every_months=3, starts="2026-08")  # Aug, Nov, Feb...
    assert _items(client)[1][key]["state"] == "due"
    december = client.get("/recurring", params={"month": "2026-12"}).json()
    item = next(i for i in december["items"] if i["key"] == key)
    assert (item["state"], item["next_date"], item["cadence"]) == ("later", "2027-02-15", "quarterly")


def test_payments_of_an_added_bill_are_not_also_found_as_a_repeating_bill(ctx):
    db, client = ctx
    _ziggo(db)
    assert "ziggo internet" in _items(client)[1]
    key = _gym(client, name="Internet", matches="ziggo", day=12)
    items = _items(client)[1]
    assert "ziggo internet" not in items
    assert items[key]["state"] == "due" and items[key]["last_date"] == "2026-10-12"


def test_an_ignored_added_bill_is_not_counted(ctx):
    db, client = ctx
    key = _gym(client)
    client.post("/recurring/ignored", json={"key": key})
    body, items = _items(client)
    assert items[key]["state"] == "ignored" and body["due_cents"] == 0


def test_a_new_amount_and_day_for_a_found_bill(ctx):
    db, client = ctx
    _ziggo(db)
    assert client.patch("/recurring/bills/ziggo internet", json={"amount_cents": 5250}).status_code == 200
    body, items = _items(client)
    ziggo = items["ziggo internet"]
    assert (ziggo["amount_cents"], ziggo["found_amount_cents"], body["due_cents"]) == (5250, 4500, 5250)

    client.patch("/recurring/bills/ziggo internet", json={"day": 20})
    ziggo = _items(client)[1]["ziggo internet"]
    assert (ziggo["next_date"], ziggo["day"], ziggo["amount_cents"]) == ("2026-11-20", 20, 5250)

    client.patch("/recurring/bills/ziggo internet", json={"amount_cents": None, "day": None})
    assert db.query(BillChange).count() == 0
    ziggo = _items(client)[1]["ziggo internet"]
    assert (ziggo["amount_cents"], ziggo["next_date"], ziggo["day"]) == (4500, "2026-11-12", None)


def test_a_day_moved_earlier_than_this_months_payment_waits_for_next_month(ctx):
    db, client = ctx
    for d in (date(2026, 8, 26), date(2026, 9, 26), date(2026, 10, 26)):
        _add(db, d, -1850, "Hypotheek ING")
    client.patch("/recurring/bills/hypotheek ing", json={"day": 2})
    mortgage = _items(client)[1]["hypotheek ing"]
    assert (mortgage["state"], mortgage["next_date"]) == ("paid", "2026-12-02")


@pytest.mark.parametrize("path,body,status,detail", [
    ("/recurring/bills", {"name": "X", "amount_cents": 0, "day": 3}, 422, "The amount must be more than zero cents"),
    ("/recurring/bills", {"name": "Gym", "amount_cents": 100, "day": 32}, 422, "The day must be a day of the month, 1 to 31"),
    ("/recurring/bills", {"name": "Gym", "amount_cents": 100, "day": 3, "every_months": 13}, 422, "How often it comes must be every 1 to 12 months"),
    ("/recurring/bills", {"name": "Gym", "amount_cents": 100, "day": 3, "starts": "Nov"}, 422, "The first month must be written as YYYY-MM"),
    ("/recurring/bills", {"name": "Gym", "amount_cents": 100, "day": 3, "matches": "ab"}, 422, "The text to find its payments by needs at least 3 characters"),
    ("/recurring/bills", {"name": " ", "amount_cents": 100, "day": 3}, 422, "The bill's name is missing"),
    ("/recurring/bills", {"name": "Gym", "amount_cents": 100, "day": 3, "category_id": 999}, 422, "Category 999 does not exist"),
])
def test_what_a_bill_cannot_be(ctx, path, body, status, detail):
    _, client = ctx
    response = client.post(path, json=body)
    assert (response.status_code, response.json()["detail"]) == (status, detail)


def test_a_bill_goes_in_a_needs_or_wants_category(ctx):
    db, client = ctx
    savings = db.query(Category).filter(Category.type == "savings").first()
    response = client.post("/recurring/bills", json={"name": "Gym", "amount_cents": 100, "day": 3, "category_id": savings.id})
    assert response.json()["detail"] == f"A fixed bill goes in a needs or wants category; {savings.name} is a savings category"


def test_what_cannot_be_changed_or_deleted(ctx):
    db, client = ctx
    _ziggo(db)
    for d in (date(2026, 10, 19), date(2026, 10, 26), date(2026, 11, 2)):
        _add(db, d, -10, "Glazenwasser")
    assert client.patch("/recurring/bills/nope", json={"amount_cents": 100}).json()["detail"] == "There is no fixed bill with the key 'nope'"
    assert client.patch("/recurring/bills/ziggo internet", json={"name": "Net"}).json()["detail"] == (
        "Only the amount and the day of a fixed bill found from payments can be changed, not name")
    assert client.patch("/recurring/bills/glazenwasser", json={"day": 3}).json()["detail"] == (
        "Glazenwasser comes weekly, so it has no day of the month to change")
    assert client.delete("/recurring/bills/ziggo internet").status_code == 422
    assert client.delete("/recurring/bills/added-9").json()["detail"] == "There is no added bill with the key 'added-9'"
    key = _gym(client)
    assert client.post("/recurring/bills", json={"name": "Sportschool", "amount_cents": 100, "day": 3}).json()["detail"] == (
        f"There is already an added bill called Sportschool ({key})")
    assert client.patch(f"/recurring/bills/{key}", json={"day": None}).json()["detail"] == "An added bill's day cannot be left empty"


def test_an_added_bill_is_changed_and_deleted(ctx):
    db, client = ctx
    key = _gym(client)
    client.patch(f"/recurring/bills/{key}", json={"amount_cents": 4500, "day": 20, "name": "Gym"})
    gym = _items(client)[1][key]
    assert (gym["name"], gym["amount_cents"], gym["next_date"]) == ("Gym", 4500, "2026-11-20")
    client.post("/recurring/ignored", json={"key": key})
    assert client.delete(f"/recurring/bills/{key}").status_code == 200
    assert key not in _items(client)[1]
    assert db.query(AddedBill).count() == 0


# ---- Free to spend: the Month page and the chat agree ---------------------------------------------

def test_the_month_overview_counts_an_added_bill_until_its_payment(ctx):
    db, client = ctx
    before = queries.month_overview()["fixed_bills_still_to_come_cents"]
    key = _gym(client)
    overview = queries.month_overview()
    assert overview["fixed_bills_still_to_come_cents"] == before + 4000
    gym = next(b for b in overview["upcoming_bills"] if b["key"] == key)
    assert gym["added"] is True and gym["amount_cents"] == 4000

    _add(db, date(2026, 11, 8), -40, "Sportschool Fit BV")
    overview = queries.month_overview()
    assert overview["fixed_bills_still_to_come_cents"] == before
    assert key not in {b["key"] for b in overview["upcoming_bills"]}


def test_the_month_overview_uses_a_new_amount(ctx):
    db, client = ctx
    _ziggo(db)
    before = queries.month_overview()["fixed_bills_still_to_come_cents"]
    client.patch("/recurring/bills/ziggo internet", json={"amount_cents": 6000})
    assert queries.month_overview()["fixed_bills_still_to_come_cents"] == before + 1500


# ---- The chat's cards ----------------------------------------------------------------------------

def _apply(name, args):
    shown = actions.preview(name, args)
    return actions.apply(name, args, shown, on_commit=lambda conn, fresh: None, precheck=lambda conn: None)


def test_bill_add_card_says_what_is_added(ctx):
    db, _ = ctx
    wants = _category_id(db, "Recreation & Entertainment")
    preview = actions.preview("bill.add", {"name": "Sportschool", "amount_cents": 4000, "day": 15,
                                           "starts": "2026-11", "category_id": wants})
    assert actions.plain(preview)["lines"] == [
        "New: Fixed bill “Sportschool”: €40,00, the 15th, Every month, November 2026, “Sportschool” in a payment, "
        "Recreation & Entertainment"]
    _apply("bill.add", {"name": "Sportschool", "amount_cents": 4000, "day": 15, "starts": "2026-11", "category_id": wants})
    db.expire_all()
    assert db.query(AddedBill).one().category_id == wants


def test_bill_update_card_for_a_found_bill_and_back(ctx):
    db, _ = ctx
    _ziggo(db)
    preview = actions.preview("bill.update", {"key": "ziggo internet", "amount_cents": 5250})
    assert actions.plain(preview)["lines"] == ["Changed: Fixed bill “ziggo internet”: €52,50"]
    _apply("bill.update", {"key": "ziggo internet", "amount_cents": 5250, "day": 20})
    preview = actions.preview("bill.update", {"key": "ziggo internet", "day": None})
    assert actions.plain(preview)["lines"] == ["Fixed bill “ziggo internet”: paid on the 20th → as the payments show"]
    preview = actions.preview("bill.update", {"key": "ziggo internet", "day": None, "amount_cents": None})
    assert actions.plain(preview)["lines"] == ["As the payments show again: Fixed bill “ziggo internet”"]


def test_bill_update_and_delete_cards_for_an_added_bill(ctx):
    db, client = ctx
    key = _gym(client)
    preview = actions.preview("bill.update", {"key": key, "amount_cents": 4500})
    assert actions.plain(preview)["lines"] == ["Fixed bill “Sportschool”: amount €40,00 → €45,00"]
    preview = actions.preview("bill.delete", {"key": key})
    assert actions.plain(preview)["lines"] == ["Removed: Fixed bill “Sportschool”"]


def test_bill_cards_refuse_with_a_reason(ctx):
    db, client = ctx
    with pytest.raises(actions.ActionError, match="bill.update has no field 'amount'"):
        actions.preview("bill.update", {"key": "x", "amount": 100})
    with pytest.raises(actions.ActionError, match="A new bill has no key yet"):
        actions.preview("bill.add", {"key": "added-1", "name": "Gym", "amount_cents": 100, "day": 3})
    with pytest.raises(actions.ActionError, match="The amount is not a whole number of cents"):
        actions.preview("bill.add", {"name": "Gym", "amount_cents": 1.5, "day": 3})
    with pytest.raises(actions.ActionError, match="one found from payments can be marked as not a fixed bill"):
        actions.preview("bill.delete", {"key": "ziggo internet"})
    with pytest.raises(actions.ActionError, match="The bill's key is missing"):
        actions.preview("bill.delete", {})


def test_claude_reads_every_fixed_bill(ctx):
    db, client = ctx
    _ziggo(db)
    key = _gym(client)
    client.patch("/recurring/bills/ziggo internet", json={"amount_cents": 5000})
    views = queries.Views()
    try:
        rows = views.run("q", "SELECT key, added, amount_cents, found_amount_cents, state, matches FROM fixed_bills ORDER BY key")
    finally:
        views.close()
    assert rows["rows"] == [[key, 1, 4000, None, "due", "Sportschool"], ["ziggo internet", 0, 5000, 4500, "due", None]]
