from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from db import get_db
from main import app
from models import Budget, Category, Transaction, TransactionSplit
from routers import dashboard as dashboard_router
from seed import run_seed


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    monkeypatch.setattr(dashboard_router, "_today", lambda: date(2026, 4, 8))  # label April: Mar 24 - Apr 23
    yield TestClient(app)
    app.dependency_overrides.clear()


def _cat(db, name):
    return db.query(Category).filter_by(name=name).one()


def _tx(db, when, euros, category, *, source="ing", confirmed=True, key=None, is_refund=False):
    tx = Transaction(
        date=when, amount=Decimal(euros), description="x", source=source,
        category_id=category.id if category else None, confirmed=confirmed,
        import_hash=key or f"{when}-{euros}-{source}-{confirmed}", is_refund=is_refund,
    )
    db.add(tx)
    db.commit()
    return tx


def _set_plan(db, label, amounts):
    client_month = date(*label, 1)
    for name, euros in amounts.items():
        row = db.query(Budget).filter_by(category_id=_cat(db, name).id, month=client_month).first()
        if row:
            row.planned_amount = Decimal(euros)
        else:
            db.add(Budget(category_id=_cat(db, name).id, month=client_month, planned_amount=Decimal(euros)))
    db.commit()


def test_no_month_means_the_financial_month_containing_today(db, client, monkeypatch):
    monkeypatch.setattr(dashboard_router, "_today", lambda: date(2026, 4, 25))
    body = client.get("/dashboard/pace").json()
    assert body["month"] == "2026-05"  # the 25th is already in May's financial month
    assert (body["start_date"], body["end_date"]) == ("2026-04-24", "2026-05-23")
    assert body["day_number"] == 2


def test_empty_when_no_bank_file_was_ever_imported(client):
    body = client.get("/dashboard/pace").json()
    assert body["status"] == "empty"
    assert body["daily"] == []
    assert body["pace_delta_cents"] is None
    assert body["behind_months"] == []
    assert [b["source"] for b in body["last_import_by_bank"]] == ["ing", "revolut", "degiro"]


def test_gap_names_the_months_since_the_last_bank_file(db, client):
    _tx(db, date(2026, 2, 10), "-10.00", _cat(db, "Utilities"))  # label February
    body = client.get("/dashboard/pace").json()
    assert body["status"] == "gap"
    assert body["data_through"] is None
    assert body["behind_months"] == ["2026-02", "2026-03", "2026-04"]
    bank = {b["source"]: b["last_date"] for b in body["last_import_by_bank"]}
    assert bank == {"ing": "2026-02-10", "revolut": None, "degiro": None}


def test_manual_entries_alone_do_not_answer_the_month(db, client):
    _tx(db, date(2026, 4, 1), "-10.00", _cat(db, "Utilities"), source="manual")
    assert client.get("/dashboard/pace").json()["status"] == "empty"


def test_pace_counts_needs_and_wants_through_the_last_bank_day(db, client):
    _set_plan(db, (2026, 4), {"Utilities": "310.00", "Miscellaneous": "0.00"})
    needs = _cat(db, "Utilities")
    wants = _cat(db, "Miscellaneous")
    savings = _cat(db, "DEGIRO")
    _tx(db, date(2026, 3, 24), "-20.00", needs)
    _tx(db, date(2026, 3, 26), "-5.00", wants)
    _tx(db, date(2026, 3, 26), "-100.00", savings)   # savings: not spendable
    _tx(db, date(2026, 3, 26), "-40.00", needs, confirmed=False)  # waiting for review

    body = client.get("/dashboard/pace").json()

    assert body["status"] == "ok"
    assert body["data_through"] == "2026-03-26"
    assert [d["cumulative_cents"] for d in body["daily"]] == [2000, 2000, 2500]
    assert body["actual_cents"]["savings"] == 10000
    assert body["spendable_actual_cents"] == 2500
    assert body["to_review"] == 1
    plan = body["spendable_plan_cents"]
    assert body["pace_delta_cents"] == 2500 - plan * 3 // body["days_total"]


def test_refunds_and_splits_net_like_every_other_total(db, client):
    needs = _cat(db, "Utilities")
    wants = _cat(db, "Miscellaneous")
    _tx(db, date(2026, 3, 25), "10.00", needs, is_refund=True)
    split = _tx(db, date(2026, 3, 25), "-30.00", None, key="split")
    db.add_all([
        TransactionSplit(transaction_id=split.id, category_id=needs.id, amount=Decimal("-20.00")),
        TransactionSplit(transaction_id=split.id, category_id=wants.id, amount=Decimal("-10.00")),
    ])
    db.commit()

    body = client.get("/dashboard/pace?month=2026-04").json()

    assert body["actual_cents"]["needs"] == 1000
    assert body["actual_cents"]["wants"] == 1000
    assert body["daily"][-1]["cumulative_cents"] == 2000


def test_past_month_has_no_today_position(db, client):
    _tx(db, date(2026, 2, 26), "-10.00", _cat(db, "Utilities"))
    body = client.get("/dashboard/pace?month=2026-03").json()
    assert body["status"] == "ok"
    assert body["day_number"] is None and body["days_left"] is None
    assert body["current_month"] == "2026-04"


def test_bad_month_is_rejected(client):
    assert client.get("/dashboard/pace?month=April").status_code == 422
