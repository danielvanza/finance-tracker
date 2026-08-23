"""Contract seam tests for the re-platform quality floor (task t_7205a29a).

Every endpoint id in contracts/api-contracts.json must (a) exist as a route on
the FastAPI app and (b) round-trip a real request/response through TestClient
in the declared v2 wire shape (money as integer cents).

Suppression guard: this module IS an anchor of the contract substrate. If the
contracts directory (manifest.json, api-contracts.json, schema.json) or the
mirrored frontend seam suite (frontend/src/tests/contract.test.ts) is deleted,
this module aborts the entire pytest run with returncode 4 instead of silently
collecting zero tests. The frontend suite mirrors the same guard, so every
deletion scenario kills at least one suite.
"""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
import models  # noqa: F401 — register all models before create_all
from main import app
from models import Category, Rule, Transaction
from seed import run_seed

REPO_ROOT = Path(__file__).resolve().parents[2]

_SUBSTRATE = [
    REPO_ROOT / "contracts" / "manifest.json",
    REPO_ROOT / "contracts" / "api-contracts.json",
    REPO_ROOT / "contracts" / "schema.json",
    REPO_ROOT / "frontend" / "src" / "tests" / "contract.test.ts",
]
_MISSING = [str(p.relative_to(REPO_ROOT)) for p in _SUBSTRATE if not p.exists()]
if _MISSING:
    pytest.exit(
        "suppression guard: contract substrate removed (missing: "
        + ", ".join(_MISSING) + ")",
        returncode=4,
    )

with open(REPO_ROOT / "contracts" / "api-contracts.json") as _fh:
    _CONTRACTS = json.load(_fh)

ENDPOINTS = {e["id"]: e for e in _CONTRACTS["endpoints"]}
XFAIL_REASON = "legacy dict wire format; flips when B2 rewires routers"

TX_OUT_KEYS = {
    "id", "date", "amount_cents", "description", "source", "category_id",
    "category_name", "confirmed", "categorised_by", "ai_confidence",
    "is_refund", "standing_adjustment_id", "splits",
}
SPLIT_OUT_KEYS = {"id", "category_id", "category_name", "amount_cents", "is_refund"}
SA_OUT_KEYS = {
    "id", "name", "amount_cents", "income_category_id", "expense_category_id",
    "active", "start_month",
}


def ep(endpoint_id):
    try:
        return ENDPOINTS[endpoint_id]
    except KeyError:
        raise KeyError(f"unknown endpoint id in api-contracts.json: {endpoint_id!r}") from None


# ING sample copied from backend/tests/test_importers.py (semicolon CSV,
# quoted headers)
ING_CSV = """"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"
"20260301";"Albert Heijn";"NL57INGB0000000000";"";"BA";"Debit";"67,40";"Payment terminal";"";"";"";""
"20260302";"Salaris Bedrijf BV";"NL57INGB0000000000";"NL00INGB0002222222";"GT";"Credit";"3460,26";"Online Banking";"Maandloon";"";"";""
"""


@pytest.fixture
def client(db):
    engine = db.get_bind()
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    food = db.query(Category).filter_by(name="Food - Essential").one()
    db.add(Transaction(
        date=date(2026, 3, 1), amount=Decimal("-45.00"),
        description="Albert Heijn weekly", source="ing",
        category_id=food.id, confirmed=True, categorised_by="rule",
        import_hash="seam-hash-1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 2), amount=Decimal("-10.00"),
        description="Bol.com order", source="revolut",
        category_id=food.id, confirmed=False, categorised_by="ai",
        ai_confidence=0.7, import_hash="seam-hash-2",
    ))
    db.add(Transaction(
        date=date(2026, 3, 3), amount=Decimal("-12.34"),
        description="ALBERT HEIJN extra", source="ing",
        category_id=food.id, confirmed=False, categorised_by="ai",
        ai_confidence=0.6, import_hash="seam-hash-3",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _food(db):
    return db.query(Category).filter_by(name="Food - Essential").one()


def _salary(db):
    return db.query(Category).filter_by(name="Salary").one()


# ---------------------------------------------------------------------------
# Route existence: every contract (method, path-template) resolves on the app
# ---------------------------------------------------------------------------

ROUTER_PREFIXES = [
    "/import", "/transactions", "/budget", "/rules", "/dashboard",
    "/categories", "/settings", "/standing-adjustments",
]


def _iter_api_routes(routes):
    """Yield APIRoute objects from the app's route tree. Newer FastAPI versions
    nest included routers (_IncludedRouter.original_router) instead of
    flattening them into app.routes."""
    for route in routes:
        if getattr(route, "path_format", None) is not None:
            yield route
            continue
        nested = getattr(route, "original_router", None)
        if nested is not None:
            yield from _iter_api_routes(nested.routes)
        elif hasattr(route, "routes"):
            yield from _iter_api_routes(route.routes)


def test_route_exists_for_every_contract_endpoint():
    route_table = {}
    for route in _iter_api_routes(app.routes):
        fmt = route.path_format
        for m in getattr(route, "methods", ()) or ():
            route_table[(m.upper(), fmt)] = route

    missing = []
    for eid in ENDPOINTS:
        spec_ = ep(eid)
        method, path = spec_["method"], spec_["path"]
        if eid != "health":
            owner = next(
                (p for p in ROUTER_PREFIXES if path == p or path.startswith(p + "/")),
                None,
            )
            assert owner, f"{eid}: contract path {path} matches no known router prefix"
        if (method, path) not in route_table:
            missing.append(f"{eid} ({method} {path})")

    assert not missing, (
        "contract endpoints missing from FastAPI app: " + "; ".join(missing)
    )


# ---------------------------------------------------------------------------
# Round trips — PASS today (full contract shape asserted)
# ---------------------------------------------------------------------------

def test_seam_health(client):
    r = client.get(ep("health")["path"])
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"status"}
    assert body["status"] == "ok"


def test_seam_import_preview(client):
    r = client.post(
        ep("import-preview")["path"],
        data={"source": "ing"},
        files={"file": ("statement.csv", ING_CSV.encode(), "text/csv")},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"rows", "total", "duplicates"}
    assert body["total"] == 2
    assert body["duplicates"] == 0
    assert len(body["rows"]) == 2
    row = body["rows"][0]
    assert set(row.keys()) == {
        "date", "amount_cents", "description", "source", "import_hash", "duplicate",
    }
    assert row["date"] == "2026-03-01"
    assert row["amount_cents"] == -6740
    assert isinstance(row["amount_cents"], int)
    assert row["description"] == "Albert Heijn"
    assert row["source"] == "ing"
    assert isinstance(row["duplicate"], bool)
    assert isinstance(row["import_hash"], str) and row["import_hash"]


def test_seam_import_confirm(client):
    quintet = {
        "imported", "skipped_duplicates", "categorised_by_rule",
        "categorised_by_ai", "uncategorised",
    }
    r1 = client.post(
        ep("import-confirm")["path"],
        data={"source": "ing"},
        files={"file": ("statement.csv", ING_CSV.encode(), "text/csv")},
    )
    assert r1.status_code == 200
    b1 = r1.json()
    assert set(b1.keys()) == quintet
    assert all(isinstance(v, int) for v in b1.values())
    assert b1["imported"] == 2
    assert b1["skipped_duplicates"] == 0
    assert b1["categorised_by_rule"] == 0  # no rules seeded yet
    assert (
        b1["categorised_by_rule"] + b1["categorised_by_ai"] + b1["uncategorised"]
        == b1["imported"]
    )

    r2 = client.post(
        ep("import-confirm")["path"],
        data={"source": "ing"},
        files={"file": ("statement.csv", ING_CSV.encode(), "text/csv")},
    )
    assert r2.status_code == 200
    b2 = r2.json()
    assert set(b2.keys()) == quintet
    assert b2["imported"] == 0
    assert b2["skipped_duplicates"] == 2


def test_seam_transaction_delete(client, db):
    manual = Transaction(
        date=date(2026, 3, 7), amount=Decimal("-5.00"),
        description="Seam deletable", source="manual",
        category_id=_food(db).id, confirmed=True, categorised_by="manual",
        import_hash="seam-hash-manual-del",
    )
    db.add(manual)
    db.commit()

    r = client.delete(ep("transaction-delete")["path"].format(tx_id=manual.id))
    assert r.status_code == 200
    assert r.json() == {"deleted": manual.id}

    ing_tx = db.query(Transaction).filter_by(description="Albert Heijn weekly").one()
    r2 = client.delete(ep("transaction-delete")["path"].format(tx_id=ing_tx.id))
    assert r2.status_code == 422
    assert isinstance(r2.json().get("detail"), str)


def test_seam_transaction_create_rule(client, db):
    extra = db.query(Transaction).filter_by(description="ALBERT HEIJN extra").one()
    r = client.post(ep("transaction-create-rule")["path"].format(tx_id=extra.id))
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"rule_created", "transactions_updated"}
    assert body["rule_created"] == "albert heijn extra"
    assert isinstance(body["transactions_updated"], int)
    assert body["transactions_updated"] >= 1

    orphan = Transaction(
        date=date(2026, 3, 8), amount=Decimal("-1.00"),
        description="Orphan seam", source="revolut",
        category_id=None, confirmed=False,
        import_hash="seam-hash-orphan",
    )
    db.add(orphan)
    db.commit()
    r2 = client.post(ep("transaction-create-rule")["path"].format(tx_id=orphan.id))
    assert r2.status_code == 400


def test_seam_standing_adjustments_list(client):
    r = client.get(ep("standing-adjustments-list")["path"])
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2  # seeded partner pair
    for sa in rows:
        assert set(sa.keys()) == SA_OUT_KEYS
        assert isinstance(sa["amount_cents"], int) and sa["amount_cents"] > 0
        assert isinstance(sa["active"], bool)
        assert isinstance(sa["start_month"], str) and len(sa["start_month"]) == 10


def test_seam_standing_adjustment_create(client, db):
    r = client.post(
        ep("standing-adjustment-create")["path"],
        json={
            "name": "Seam allowance",
            "amount_cents": 2500,
            "income_category_id": _salary(db).id,
            "expense_category_id": _food(db).id,
        },
    )
    assert r.status_code == 201
    sa = r.json()
    assert set(sa.keys()) == SA_OUT_KEYS
    assert sa["name"] == "Seam allowance"
    assert sa["amount_cents"] == 2500
    assert sa["active"] is True


def test_seam_standing_adjustment_patch(client, db):
    sa = db.query(models.StandingAdjustment).first()
    r = client.patch(
        ep("standing-adjustment-patch")["path"].format(sa_id=sa.id),
        json={"active": False, "amount_cents": 30000},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == SA_OUT_KEYS
    assert body["active"] is False
    assert body["amount_cents"] == 30000


def test_seam_standing_adjustment_delete(client, db):
    r = client.post(
        ep("standing-adjustment-create")["path"],
        json={
            "name": "Doomed adjustment",
            "amount_cents": 1000,
            "income_category_id": _salary(db).id,
            "expense_category_id": _food(db).id,
        },
    )
    assert r.status_code == 201
    sa_id = r.json()["id"]

    r2 = client.delete(ep("standing-adjustment-delete")["path"].format(sa_id=sa_id))
    assert r2.status_code == 200
    assert r2.json() == {"deleted": sa_id}


def test_seam_categories_list(client):
    r = client.get(ep("categories-list")["path"])
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 21  # 16 expense + 4 income + 1 exclude seeded
    orders = [c["sort_order"] for c in rows]
    assert orders == sorted(orders)
    for c in rows:
        assert set(c.keys()) == {"id", "name", "type", "sort_order"}
        assert c["type"] in ("needs", "wants", "savings", "income", "exclude")


def test_seam_category_create(client):
    r = client.post(
        ep("category-create")["path"],
        json={"name": "Seam Cat", "type": "wants"},
    )
    assert r.status_code == 201
    cat = r.json()
    assert set(cat.keys()) == {"id", "name", "type", "sort_order"}
    assert cat["name"] == "Seam Cat"
    assert cat["type"] == "wants"
    assert isinstance(cat["sort_order"], int)


def test_seam_category_patch(client):
    created = client.post(
        ep("category-create")["path"],
        json={"name": "Patch Me Cat", "type": "savings"},
    ).json()
    r = client.patch(
        ep("category-patch")["path"].format(category_id=created["id"]),
        json={"name": "Patched Cat"},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"id", "name", "type", "sort_order"}
    assert body["name"] == "Patched Cat"
    assert body["type"] == "savings"


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_category_type_change_guard(client):
    """v2 guard: type change blocked (422 + census detail) while dependents
    exist unless force:true — ships with B2."""
    created = client.post(
        ep("category-create")["path"],
        json={"name": "Guard Cat", "type": "wants"},
    ).json()
    client.post(
        ep("rule-create")["path"],
        json={"pattern": "guard-cat-dependent", "category_id": created["id"]},
    )

    blocked = client.patch(
        ep("category-patch")["path"].format(category_id=created["id"]),
        json={"type": "needs"},
    )
    assert blocked.status_code == 422
    assert isinstance(blocked.json().get("detail"), str)

    forced = client.patch(
        ep("category-patch")["path"].format(category_id=created["id"]),
        json={"type": "needs", "force": True},
    )
    assert forced.status_code == 200
    assert forced.json()["type"] == "needs"


def test_seam_category_reorder(client, db):
    cats = db.query(Category).order_by(Category.sort_order).limit(3).all()
    requested_ids = [c.id for c in reversed(cats)]

    r = client.patch(
        ep("category-reorder")["path"],
        json={"category_ids": requested_ids},
    )
    assert r.status_code == 200
    out = r.json()
    assert [e["id"] for e in out] == requested_ids  # response in REQUEST order
    orders = [e["sort_order"] for e in out]
    assert orders == sorted(orders)
    for e in out:
        assert set(e.keys()) == {"id", "sort_order"}


def test_seam_category_delete(client):
    unused = client.post(
        ep("category-create")["path"],
        json={"name": "Doomed Cat", "type": "savings"},
    ).json()
    r = client.delete(ep("category-delete")["path"].format(category_id=unused["id"]))
    assert r.status_code == 200
    assert r.json() == {"deleted": unused["id"]}


def test_seam_category_delete_in_use(client, db):
    r = client.delete(
        ep("category-delete")["path"].format(category_id=_food(db).id)
    )
    assert r.status_code == 422
    detail = r.json().get("detail")
    assert isinstance(detail, str) and detail


def test_seam_rules_list(client, db):
    db.add(Rule(pattern="seam list pattern", category_id=_food(db).id, priority=3))
    db.add(Rule(pattern="seam list pattern 2", category_id=_food(db).id, priority=7))
    db.commit()

    r = client.get(ep("rules-list")["path"])
    assert r.status_code == 200
    rows = r.json()
    priorities = [x["priority"] for x in rows]
    assert priorities == sorted(priorities, reverse=True)
    for x in rows:
        assert set(x.keys()) == {"id", "pattern", "category_id", "category_name", "priority"}


def test_seam_rule_create(client, db):
    r = client.post(
        ep("rule-create")["path"],
        json={"pattern": "seam albert", "category_id": _food(db).id, "priority": 5},
    )
    assert r.status_code == 200
    rule = r.json()
    assert set(rule.keys()) == {"id", "pattern", "category_id", "category_name", "priority"}
    assert rule["pattern"] == "seam albert"
    assert rule["category_name"] == "Food - Essential"
    assert rule["priority"] == 5


def test_seam_rule_update(client, db):
    rule = Rule(pattern="seam update me", category_id=_food(db).id, priority=1)
    db.add(rule)
    db.commit()

    r = client.patch(
        ep("rule-update")["path"].format(rule_id=rule.id),
        json={"priority": 9},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"id", "pattern", "category_id", "category_name", "priority"}
    assert body["priority"] == 9
    assert body["pattern"] == "seam update me"


def test_seam_rule_delete(client, db):
    rule = Rule(pattern="seam delete me", category_id=_food(db).id, priority=0)
    db.add(rule)
    db.commit()

    r = client.delete(ep("rule-delete")["path"].format(rule_id=rule.id))
    assert r.status_code == 200
    assert r.json() == {"deleted": rule.id}


def test_seam_rule_test(client):
    r = client.post(ep("rule-test")["path"], json={"pattern": "albert"})
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"matches", "examples"}
    assert body["matches"] >= 1
    assert isinstance(body["examples"], list)
    assert all(isinstance(e, str) for e in body["examples"])
    assert len(body["examples"]) <= 5


def test_seam_settings_get(client):
    r = client.get(ep("settings-get")["path"])
    assert r.status_code == 200
    body = r.json()
    assert "financial_month_start_day" in body
    assert all(isinstance(v, str) for v in body.values())


def test_seam_setting_patch(client):
    ok = client.patch(
        ep("setting-patch")["path"].format(key="financial_month_start_day"),
        json={"value": "1"},
    )
    assert ok.status_code == 200
    assert ok.json() == {"key": "financial_month_start_day", "value": "1"}

    unknown = client.patch(
        ep("setting-patch")["path"].format(key="no-such-key"),
        json={"value": "x"},
    )
    assert unknown.status_code == 404

    invalid = client.patch(
        ep("setting-patch")["path"].format(key="financial_month_start_day"),
        json={"value": "29"},
    )
    assert invalid.status_code == 422


# ---------------------------------------------------------------------------
# Round trips — xfail(strict) until B2 rewires hand-built dict responses
# ---------------------------------------------------------------------------

LABEL_MONTH = "2026-01"


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_seam_transactions_list(client):
    r = client.get(ep("transactions-list")["path"])
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 3
    assert items[0]["confirmed"] is False  # unconfirmed first
    confirmed_dates = [t["date"] for t in items if t["confirmed"]]
    assert confirmed_dates == sorted(confirmed_dates, reverse=True)
    for tx in items:
        assert set(tx.keys()) == TX_OUT_KEYS
        assert isinstance(tx["amount_cents"], int)
        assert tx["source"] in ("ing", "revolut", "degiro", "manual")
        assert isinstance(tx["is_refund"], bool)
        for s in tx["splits"]:
            assert set(s.keys()) == SPLIT_OUT_KEYS
            assert isinstance(s["amount_cents"], int)
            assert isinstance(s["is_refund"], bool)


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_seam_transactions_next_review(client):
    r = client.get(ep("transactions-next-review")["path"])
    assert r.status_code == 200
    body = r.json()
    assert body is not None  # seeded review queue is non-empty
    assert set(body.keys()) == TX_OUT_KEYS
    assert isinstance(body["amount_cents"], int)
    assert body["confirmed"] is False

    r2 = client.get(
        ep("transactions-next-review")["path"] + f"?skip_ids={body['id']}"
    )
    assert r2.status_code == 200
    nxt = r2.json()
    if nxt is not None:
        assert nxt["id"] != body["id"]
        assert set(nxt.keys()) == TX_OUT_KEYS


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_seam_transaction_create(client, db):
    r = client.post(
        ep("transaction-create")["path"],
        json={
            "date": "2026-03-05",
            "amount_cents": -1500,
            "description": "Seam manual expense",
            "category_id": _food(db).id,
        },
    )
    assert r.status_code == 201
    tx = r.json()
    assert set(tx.keys()) == TX_OUT_KEYS
    assert isinstance(tx["amount_cents"], int)
    assert tx["amount_cents"] == -1500
    assert tx["source"] == "manual"
    assert tx["confirmed"] is True
    assert tx["categorised_by"] == "manual"


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_seam_transaction_adjustment_pair(client, db):
    r = client.post(
        ep("transaction-adjustment-pair")["path"],
        json={
            "date": "2026-03-06",
            "description": "Seam internal correction",
            "legs": [
                {"amount_cents": 2500, "category_id": _salary(db).id},
                {"amount_cents": -2500, "category_id": _food(db).id},
            ],
        },
    )
    assert r.status_code == 201
    pair = r.json()
    assert isinstance(pair, list) and len(pair) == 2
    for tx in pair:
        assert set(tx.keys()) == TX_OUT_KEYS
        assert isinstance(tx["amount_cents"], int)
    assert sum(t["amount_cents"] for t in pair) == 0


@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
def test_seam_transaction_patch(client, db):
    bol = db.query(Transaction).filter_by(description="Bol.com order").one()
    utilities = db.query(Category).filter_by(name="Utilities").one()
    r = client.patch(
        ep("transaction-patch")["path"].format(tx_id=bol.id),
        json={
            "confirmed": True,
            "splits": [
                {"category_id": utilities.id, "amount_cents": -600},
                {"category_id": _food(db).id, "amount_cents": -400},
            ],
        },
    )
    assert r.status_code == 200
    tx = r.json()
    assert set(tx.keys()) == TX_OUT_KEYS
    assert tx["confirmed"] is True
    assert tx["category_id"] is None  # split replaces single category
    assert len(tx["splits"]) == 2
    for s in tx["splits"]:
        assert set(s.keys()) == SPLIT_OUT_KEYS
        assert isinstance(s["amount_cents"], int)
        assert isinstance(s["is_refund"], bool)


def test_seam_budget_get(client):
    r = client.get(ep("budget-get")["path"], params={"month": LABEL_MONTH})
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list) and len(rows) > 0
    for row in rows:
        keys = set(row.keys())
        assert {"id", "category_id", "category_name", "month",
                "planned_amount_cents", "actual_amount_cents"} <= keys
        assert "planned_amount" not in keys and "actual_amount" not in keys
        assert isinstance(row["planned_amount_cents"], int)
        assert isinstance(row["actual_amount_cents"], int)


def test_seam_budget_patch_month(client):
    rows = client.get(ep("budget-get")["path"], params={"month": LABEL_MONTH}).json()
    budget_id = rows[0]["id"]

    r = client.patch(
        ep("budget-patch-month")["path"].format(budget_id=budget_id),
        json={"planned_amount_cents": 12345},
    )
    assert r.status_code == 200
    body = r.json()
    assert {"id", "planned_amount_cents", "category_name", "month"} <= set(body.keys())
    assert "planned_amount" not in body
    assert body["planned_amount_cents"] == 12345
    assert isinstance(body["id"], int)


def test_seam_budget_patch_default(client, db):
    r = client.patch(
        ep("budget-patch-default")["path"].format(category_id=_food(db).id),
        json={"planned_amount_cents": 9999},
    )
    assert r.status_code == 200
    body = r.json()
    assert {"category_id", "planned_amount_cents"} <= set(body.keys())
    assert "planned_amount" not in body
    assert body["planned_amount_cents"] == 9999


def test_seam_dashboard_summary(client):
    r = client.get(ep("dashboard-summary")["path"], params={"month": LABEL_MONTH})
    assert r.status_code == 200
    d = r.json()
    keys = set(d.keys())
    assert {
        "month", "total_income_cents", "total_expenses_cents",
        "total_savings_cents", "left_over_cents", "category_breakdown",
        "income_breakdown", "needs_wants_savings", "monthly_trend",
    } <= keys
    assert not ({"total_income", "total_expenses", "total_savings", "left_over"} & keys)
    for k in ("total_income_cents", "total_expenses_cents",
              "total_savings_cents", "left_over_cents"):
        assert isinstance(d[k], int)

    nws = d["needs_wants_savings"]
    assert {"needs_cents", "wants_cents", "savings_cents"} <= set(nws.keys())

    trend = d["monthly_trend"]
    assert len(trend) == 6
    for entry in trend:
        assert set(entry.keys()) == {"month", "total_cents"}
        assert isinstance(entry["total_cents"], int)
    assert trend[-1]["month"] == LABEL_MONTH
