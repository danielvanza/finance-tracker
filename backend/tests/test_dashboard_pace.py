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
    assert [b["source"] for b in body["last_import_by_bank"]] == ["ing"]


def test_gap_names_the_months_since_the_last_bank_file(db, client):
    _tx(db, date(2026, 2, 10), "-10.00", _cat(db, "Utilities"))  # label February
    body = client.get("/dashboard/pace").json()
    assert body["status"] == "gap"
    assert body["data_through"] is None
    assert body["behind_months"] == ["2026-02", "2026-03", "2026-04"]
    bank = {b["source"]: b["last_date"] for b in body["last_import_by_bank"]}
    assert bank == {"ing": "2026-02-10"}


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


def _plan_only(db, client, label, amounts):
    """A plan of exactly these amounts: the seeded defaults for the month are zeroed first."""
    client.get("/dashboard/pace", params={"month": f"{label[0]}-{label[1]:02d}"})
    db.query(Budget).filter_by(month=date(*label, 1)).update({"planned_amount": Decimal("0")})
    db.commit()
    _set_plan(db, label, amounts)


def _spread(db, start, daily_euros, category):
    """One payment a day from `start`, one amount per day."""
    from datetime import timedelta
    for i, euros in enumerate(daily_euros):
        _tx(db, start + timedelta(days=i), euros, category, key=f"spread-{i}-{category.name}")


def test_cash_left_counts_money_in_out_expected_bills_and_savings(db, client, monkeypatch):
    # today 8 Apr = day 16 of the month 24 Mar - 23 Apr (31 days)
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00", "Miscellaneous": "100.00", "DEGIRO": "50.00"})
    salary, needs, wants = _cat(db, "Salary"), _cat(db, "Utilities"), _cat(db, "Miscellaneous")
    _tx(db, date(2026, 3, 24), "1000.00", salary, key="pay")
    _spread(db, date(2026, 3, 24), ["-10.00"] * 15, needs)  # through 7 Apr: finished days
    _tx(db, date(2026, 4, 8), "-30.00", wants, key="today")  # today's part day
    for when in (date(2026, 1, 24), date(2026, 2, 24), date(2026, 3, 24)):  # a salary due 24 Apr: next month
        _tx(db, when, "1000.00", salary, key=f"s{when}")
    free = client.get("/dashboard/pace").json()["free"]
    assert free["money_in_cents"] == 200000  # the 24 Mar payment and the new one, both in this month
    assert free["spent_cents"] == 15000 + 3000
    assert free["to_save_cents"] == 5000 and free["saved_cents"] == 0
    assert free["income_expected_cents"] == 0
    expect = 200000 - 18000 - 5000 - free["bills_cents"] - free["set_aside_cents"]
    assert free["cash_left_cents"] == expect
    assert free["outside_plan_cents"] == free["cash_left_cents"] - free["free_cents"]
    assert free["still_to_come_cents"] == free["bills_cents"] + free["set_aside_cents"] + 5000


def test_saved_money_has_left_the_pot_and_replaces_the_planned_savings(db, client):
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00", "DEGIRO": "50.00"})
    _tx(db, date(2026, 3, 24), "500.00", _cat(db, "Salary"), key="pay")
    _tx(db, date(2026, 3, 25), "-80.00", _cat(db, "DEGIRO"), key="sv")  # saved more than planned
    free = client.get("/dashboard/pace").json()["free"]
    assert (free["saved_cents"], free["to_save_cents"]) == (8000, 0)
    assert free["cash_left_cents"] == 50000 - 8000 - free["bills_cents"] - free["set_aside_cents"]


def test_average_day_uses_finished_days_and_skips_big_payment_days(db, client):
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00", "Miscellaneous": "100.00"})  # plan 500: big is 50 or more
    needs = _cat(db, "Utilities")
    _spread(db, date(2026, 3, 24), ["-10.00", "-20.00", "-300.00", "-10.00", "-20.00", "-10.00", "-20.00", "-10.00",
                                     "-10.00", "-20.00", "-10.00", "-20.00", "-10.00", "-20.00", "-10.00"], needs)  # 24 Mar - 7 Apr
    _tx(db, date(2026, 4, 8), "-45.00", needs, key="today")  # today's part day must not count
    body = client.get("/dashboard/pace").json()
    assert body["data_through"] == "2026-04-08"
    day = body["ordinary_day"]
    assert (day["days"], day["spent_cents"], day["avg_cents"]) == (14, 20000, 1429)
    free = body["free"]
    assert (free["avg_day_cents"], free["avg_day_days"], free["avg_day_spent_cents"]) == (1429, 14, 20000)
    assert free["days_ahead"] == 15  # 9 Apr .. 23 Apr; today's spending is already in
    assert free["month_end_cents"] == free["cash_left_cents"] - 1429 * 15


def test_days_the_files_do_not_reach_count_as_still_ahead(db, client, monkeypatch):
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00"})
    _spread(db, date(2026, 3, 24), ["-10.00"] * 10, _cat(db, "Utilities"))  # files stop 2 Apr
    free = client.get("/dashboard/pace").json()["free"]
    assert free["avg_day_cents"] == 1000
    assert free["days_ahead"] == 21  # 3 Apr .. 23 Apr


def test_early_month_says_nothing_about_the_average_day(db, client, monkeypatch):
    monkeypatch.setattr(dashboard_router, "_today", lambda: date(2026, 3, 28))  # day 5
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00"})
    _spread(db, date(2026, 3, 24), ["-10.00"] * 4, _cat(db, "Utilities"))
    body = client.get("/dashboard/pace").json()
    assert body["ordinary_day"] is None
    assert body["free"]["avg_day_cents"] is None and body["free"]["month_end_cents"] is None
    assert body["free"]["cash_left_cents"] is not None


def test_a_past_month_has_its_average_day_and_money_in(db, client, monkeypatch):
    monkeypatch.setattr(dashboard_router, "_today", lambda: date(2026, 5, 10))
    _plan_only(db, client, (2026, 4), {"Utilities": "400.00"})
    _tx(db, date(2026, 3, 24), "900.00", _cat(db, "Salary"), key="pay")
    _spread(db, date(2026, 3, 25), ["-10.00"] * 30, _cat(db, "Utilities"))
    _tx(db, date(2026, 5, 9), "-1.00", _cat(db, "Utilities"), key="later")
    body = client.get("/dashboard/pace", params={"month": "2026-04"}).json()
    assert body["free"] is None
    assert body["money_in_cents"] == 90000
    assert (body["ordinary_day"]["avg_cents"], body["ordinary_day"]["days"]) == (968, 31)


def test_gap_and_empty_have_no_average_day(db, client):
    assert client.get("/dashboard/pace").json()["ordinary_day"] is None
    assert client.get("/dashboard/pace").json()["money_in_cents"] == 0
