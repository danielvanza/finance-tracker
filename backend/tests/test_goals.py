from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db import get_db
from models import Category, CategoryType, Setting, Transaction
from routers import goals as goals_router
from seed import run_seed

TODAY = date(2026, 11, 9)  # label November: Oct 24 - Nov 23; finished: Aug, Sep, Oct


@pytest.fixture
def client(db, monkeypatch):
    run_seed(db)
    monkeypatch.setattr(goals_router, "_today", lambda: TODAY)
    app = FastAPI()  # not registered in main.py yet: mount the router alone
    app.include_router(goals_router.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _cat(db, name):
    return db.query(Category).filter_by(name=name).one()


def _tx(db, when, euros, category, *, source="ing", confirmed=True, is_refund=False):
    db.add(Transaction(
        date=when, amount=Decimal(euros), description="x", source=source,
        category_id=_cat(db, category).id, confirmed=confirmed, is_refund=is_refund,
        import_hash=f"{when}-{euros}-{category}-{source}-{confirmed}-{is_refund}",
    ))
    db.commit()


def _reach(db):
    """A bank file that runs into the running month, so every earlier month counts as complete."""
    _tx(db, date(2026, 11, 2), "-1", "Utilities")


def _saving_each_month(db, euros="-250", category="Fun Account", months=((2026, 8), (2026, 9), (2026, 10)), reach=True):
    for y, m in months:
        _tx(db, date(y, m, 5), euros, category)
    if reach:
        _reach(db)


def _goal(db, **over):
    body = {"name": "Holiday, Portugal", "category_id": _cat(db, "Fun Account").id,
            "target_cents": 300_000, "start_cents": 40_000, "by": "2027-07", "started": "2026-08-01"}
    return {**body, **over}


def _put(client, *goals):
    r = client.put("/goals", json={"goals": list(goals)})
    assert r.status_code == 200, r.text
    return r.json()["goals"]


def test_no_goals_yet(client):
    body = client.get("/goals").json()
    assert body["goals"] == []
    assert body["max_goals"] == 5
    assert body["current_month"] == "2026-11"
    assert [c["name"] for c in body["savings_categories"]] == ["DEGIRO", "Fun Account", "Savings Transfer"]


def test_put_creates_the_setting_row_and_get_returns_it(db, client):
    assert db.get(Setting, "savings_goals") is None
    [g] = _put(client, _goal(db, started=None))
    assert db.get(Setting, "savings_goals") is not None
    assert g["started"] == "2026-11-09"
    assert g["category_name"] == "Fun Account"
    assert client.get("/goals").json()["goals"] == [g]


def test_put_replaces_the_list_and_may_empty_it(db, client):
    _put(client, _goal(db), _goal(db, category_id=_cat(db, "DEGIRO").id, name="Buffer", by=None))
    [only] = _put(client, _goal(db, name="Trip"))
    assert only["name"] == "Trip"
    assert _put(client) == []


def test_value_stays_small_enough_for_the_settings_column(db, client):
    names = ["Z" * 24] * 5
    for i in range(2):
        db.add(Category(name=f"Pot {i}", type=CategoryType.savings, sort_order=50 + i))
    db.commit()
    cats = [c.id for c in db.query(Category).filter_by(type=CategoryType.savings).limit(5)]
    goals = [_goal(db, name=n, category_id=c, target_cents=99_999_999, start_cents=99_999_999)
             for n, c in zip(names, cats)]
    _put(client, *goals)
    assert len(db.get(Setting, "savings_goals").value) <= 500


@pytest.mark.parametrize("over", [
    {"name": "  "},
    {"name": "x" * 25},
    {"by": "2027-13"},
    {"by": "July"},
    {"target_cents": 0},
    {"target_cents": 100_000_000},
    {"start_cents": -1},
])
def test_put_rejects_bad_goals(db, client, over):
    assert client.put("/goals", json={"goals": [_goal(db, **over)]}).status_code == 422


def test_put_rejects_a_category_that_is_not_savings(db, client):
    bad = _goal(db, category_id=_cat(db, "Utilities").id)
    r = client.put("/goals", json={"goals": [bad]})
    assert r.status_code == 422


def test_put_rejects_two_goals_in_one_category(db, client):
    r = client.put("/goals", json={"goals": [_goal(db), _goal(db, name="Other")]})
    assert r.status_code == 422
    assert "One goal" in r.json()["detail"]


def test_put_rejects_a_sixth_goal(db, client):
    for i in range(3):
        db.add(Category(name=f"Pot {i}", type=CategoryType.savings, sort_order=50 + i))
    db.commit()
    cats = [c.id for c in db.query(Category).filter_by(type=CategoryType.savings)]
    assert len(cats) == 6
    goals = [_goal(db, name=f"G{i}", category_id=c) for i, c in enumerate(cats)]
    assert client.put("/goals", json={"goals": goals}).status_code == 422
    assert client.put("/goals", json={"goals": goals[:5]}).status_code == 200


def test_progress_is_start_plus_savings_since_the_goal_started(db, client):
    _tx(db, date(2026, 7, 30), "-999", "Fun Account")  # before the goal started: not counted
    _tx(db, date(2026, 8, 5), "-250", "Fun Account")
    _tx(db, date(2026, 9, 5), "-250", "Fun Account", confirmed=False)  # still in review: not counted
    _tx(db, date(2026, 9, 6), "-100", "DEGIRO")  # another category: not counted
    [g] = _put(client, _goal(db))
    assert g["saved_cents"] == 40_000 + 25_000


def test_a_withdrawal_marked_as_refund_lowers_progress(db, client):
    _tx(db, date(2026, 8, 5), "-250", "Fun Account")
    _tx(db, date(2026, 9, 5), "100", "Fun Account", is_refund=True)
    [g] = _put(client, _goal(db))
    assert g["saved_cents"] == 40_000 + 15_000


def test_no_pace_with_fewer_than_two_months_of_bank_data(db, client):
    _saving_each_month(db, months=((2026, 10),))
    [g] = _put(client, _goal(db))
    assert g["pace_cents"] is None
    assert g["status"] == "unknown"
    assert g["needed_cents"] is not None  # the arithmetic of the date needs no pace


def test_pace_is_the_average_of_finished_months_and_needs_two(db, client):
    _saving_each_month(db, months=((2026, 9), (2026, 10)))
    [g] = _put(client, _goal(db))
    assert g["pace_cents"] == 25_000


def test_the_running_month_does_not_count_towards_the_pace(db, client):
    _saving_each_month(db, months=((2026, 9), (2026, 10), (2026, 11)), euros="-250")
    _tx(db, date(2026, 11, 6), "-900", "Fun Account")  # a big one in the running month
    [g] = _put(client, _goal(db))
    assert g["pace_cents"] == 25_000


def test_a_month_the_bank_files_do_not_cover_yet_is_left_out(db, client):
    _saving_each_month(db, months=((2026, 8), (2026, 9)), reach=False)
    _tx(db, date(2026, 10, 5), "-10", "Utilities")  # newest file sits in October: October is behind
    [g] = _put(client, _goal(db))
    assert g["pace_cents"] == 25_000


def test_pace_averages_over_months_with_data_only(db, client):
    _saving_each_month(db, months=((2026, 8), (2026, 10)), euros="-300")
    _tx(db, date(2026, 9, 5), "-10", "Utilities")  # September has data but nothing saved
    [g] = _put(client, _goal(db))
    assert g["pace_cents"] == 20_000


def test_on_track_when_the_pace_covers_what_each_month_needs(db, client):
    _saving_each_month(db)
    [g] = _put(client, _goal(db))
    # 3.000 - (400 + 750) = 1.850 over Nov..Jul = 9 months
    assert g["needed_cents"] == 20_556
    assert g["pace_cents"] == 25_000
    assert g["status"] == "on_track"
    assert g["short_cents"] is None


def test_short_says_by_how_much_a_month(db, client):
    _saving_each_month(db)
    [g] = _put(client, _goal(db, target_cents=600_000))
    assert g["needed_cents"] == 53_889  # 4.850 / 9, rounded up
    assert g["short_cents"] == 53_889 - 25_000
    assert g["status"] == "short"
    assert g["reach"] is not None


def test_no_date_means_open_with_a_projected_month(db, client):
    _saving_each_month(db, euros="-300")
    [g] = _put(client, _goal(db, by=None))
    assert g["status"] == "open"
    assert g["needed_cents"] is None and g["tick_pct"] is None
    # 3.000 - (400 + 900) = 1.700 at 300 a month = 6 months on from November
    assert g["reach"] == "2027-05"


def test_no_projection_while_nothing_is_added(db, client):
    _tx(db, date(2026, 9, 5), "-10", "Utilities")
    _tx(db, date(2026, 10, 5), "-10", "Utilities")
    _reach(db)
    [g] = _put(client, _goal(db, by=None))
    assert g["pace_cents"] == 0
    assert g["reach"] is None


def test_done_once_the_target_is_met(db, client):
    _saving_each_month(db)
    [g] = _put(client, _goal(db, target_cents=100_000))
    assert g["status"] == "done"
    assert g["needed_cents"] is None and g["reach"] is None


def test_late_when_the_month_has_passed(db, client):
    _saving_each_month(db)
    [g] = _put(client, _goal(db, by="2026-10"))
    assert g["status"] == "late"


def test_tick_is_where_an_even_path_would_be_today(db, client):
    [g] = _put(client, _goal(db))
    span = (date(2027, 7, 23) - date(2026, 8, 1)).days  # July's financial month ends Jul 23
    frac = (TODAY - date(2026, 8, 1)).days / span
    first = 40_000 / 300_000
    assert g["tick_pct"] == pytest.approx((first + (1 - first) * frac) * 100, abs=0.1)


def test_tick_stays_inside_the_meter(db, client):
    [late] = _put(client, _goal(db, by="2026-10"))
    assert late["tick_pct"] == 100
    [fresh] = _put(client, _goal(db, started="2026-11-09", start_cents=0))
    assert fresh["tick_pct"] == 0


def test_a_goal_whose_category_stopped_being_savings_is_left_out(db, client):
    _put(client, _goal(db))
    _cat(db, "Fun Account").type = CategoryType.needs  # as if it were no longer a savings category
    db.commit()
    assert client.get("/goals").json()["goals"] == []


def test_a_damaged_value_reads_as_no_goals(db, client):
    db.add(Setting(key="savings_goals", value="{not json"))
    db.commit()
    assert client.get("/goals").json()["goals"] == []
