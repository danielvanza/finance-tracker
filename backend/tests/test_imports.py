import pytest
from fastapi.testclient import TestClient
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
    assert [row["amount_cents"] for row in body["rows"]] == [-6740, 346026]

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


NOTED = ING_CSV.replace(b'"Maandloon"', b'"Name: Bedrijf BV Description: Maandloon maart IBAN: NL00INGB0002222222"')


def test_confirm_keeps_the_bank_note(client, db):
    from models import Transaction

    client.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", NOTED, "text/csv")})
    notes = {t.description: t.note for t in db.query(Transaction).all()}
    assert notes == {"Albert Heijn": None, "Salaris": "Name: Bedrijf BV Description: Maandloon maart IBAN: NL00INGB0002222222"}


def test_reimport_fills_in_a_note_that_was_not_kept(client, db):
    """Rows from before notes were kept get theirs when the same file comes in again, and only then."""
    from models import Transaction

    client.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", NOTED, "text/csv")})
    db.query(Transaction).update({Transaction.note: None})
    db.commit()

    body = client.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", NOTED, "text/csv")}).json()
    assert (body["imported"], body["skipped_duplicates"], body["notes_added"]) == (0, 2, 1)
    assert db.query(Transaction).filter_by(description="Salaris").one().note.endswith("NL00INGB0002222222")

    again = client.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", NOTED, "text/csv")}).json()
    assert again["notes_added"] == 0
