import pytest
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_get_settings_returns_dict(client):
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert body["financial_month_start_day"] == "24"


def test_patch_setting_valid(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "15"})
    assert r.status_code == 200
    assert r.json()["value"] == "15"

    # Verify it persisted
    r2 = client.get("/settings")
    assert r2.json()["financial_month_start_day"] == "15"


def test_patch_setting_validates_start_day_range(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "0"})
    assert r.status_code == 422

    r = client.patch("/settings/financial_month_start_day", json={"value": "29"})
    assert r.status_code == 422

    r = client.patch("/settings/financial_month_start_day", json={"value": "abc"})
    assert r.status_code == 422


def test_patch_setting_boundary_values(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "1"})
    assert r.status_code == 200

    r = client.patch("/settings/financial_month_start_day", json={"value": "28"})
    assert r.status_code == 200


def test_patch_unknown_setting_returns_404(client):
    r = client.patch("/settings/nonexistent", json={"value": "x"})
    assert r.status_code == 404
