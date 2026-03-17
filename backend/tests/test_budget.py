import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from db import get_db
from main import app
from seed import run_seed

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_budget_autopopulates_from_defaults(client):
    r = client.get("/budget?month=2026-03")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    names = [r["category_name"] for r in rows]
    assert "Food - Essential" in names

def test_budget_patch_updates_amount(client, db):
    r = client.get("/budget?month=2026-03")
    row = r.json()[0]
    new_amount = float(row["planned_amount"]) + 100
    r2 = client.patch(f"/budget/{row['id']}", json={"planned_amount": new_amount})
    assert r2.status_code == 200
    assert float(r2.json()["planned_amount"]) == new_amount
