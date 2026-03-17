import pytest
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed
from models import Category

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_create_rule(client, db):
    cat = db.query(Category).first()
    r = client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    assert r.status_code == 200
    assert r.json()["pattern"] == "ziggo"

def test_list_rules(client, db):
    cat = db.query(Category).first()
    client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    r = client.get("/rules")
    assert r.status_code == 200
    assert any(rule["pattern"] == "ziggo" for rule in r.json())

def test_delete_rule(client, db):
    cat = db.query(Category).first()
    r = client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    rule_id = r.json()["id"]
    client.delete(f"/rules/{rule_id}")
    r2 = client.get("/rules")
    assert all(rule["id"] != rule_id for rule in r2.json())
