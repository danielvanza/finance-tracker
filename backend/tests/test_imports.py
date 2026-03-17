import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from db import Base, get_db
from main import app
from seed import run_seed

ING_CSV = b""""Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"
"20260301";"Albert Heijn";"NL57INGB0000000000";"";"BA";"Debit";"67,40";"Payment terminal";"";"";"";""
"20260302";"Salaris";"NL57INGB0000000000";"NL00INGB0002222222";"GT";"Credit";"3460,26";"Online Banking";"Maandloon";"";"";""
"""

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_preview_returns_parsed_rows(client):
    r = client.post("/import/preview",
        data={"source": "ing"},
        files={"file": ("ing.csv", ING_CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["duplicates"] == 0

def test_confirm_saves_transactions(client):
    r = client.post("/import/confirm", data={"source": "ing"},
        files={"file": ("ing.csv", ING_CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 2
    assert body["skipped_duplicates"] == 0

def test_confirm_deduplicates_on_reimport(client):
    for _ in range(2):
        r = client.post("/import/confirm", data={"source": "ing"},
            files={"file": ("ing.csv", ING_CSV, "text/csv")})
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped_duplicates"] == 2
