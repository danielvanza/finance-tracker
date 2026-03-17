import io
from decimal import Decimal
from datetime import date
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter

ING_CSV = """"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"
"20260301";"Albert Heijn";"NL57INGB0000000000";"";"BA";"Debit";"67,40";"Payment terminal";"";"";"";""
"20260302";"Salaris Bedrijf BV";"NL57INGB0000000000";"NL00INGB0002222222";"GT";"Credit";"3460,26";"Online Banking";"Maandloon";"";"";""
"""

REVOLUT_CSV = """Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2026-03-05 14:22:00,2026-03-05 14:22:01,Spotify,-9.99,0.10,EUR,COMPLETED,120.01
Topup,Current,2026-03-06 09:00:00,,IDEAL Top-Up,100.00,0.00,EUR,REVERTED,
Topup,Current,2026-03-06 09:01:00,2026-03-06 09:01:15,IDEAL Top-Up,500.00,0.00,EUR,COMPLETED,620.01
"""

DEGIRO_CSV = """Date,Time,Product,ISIN,Description,FX,Change,,Balance,,Order ID
01-03-2026,10:00,VWRL ETF,IE00B3RBWM25,Buy 2 VWRL,,-300.00,EUR,100.00,EUR,order1
"""

def test_ing_parses_expense():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    expense = next(r for r in rows if r.amount < 0)
    assert expense.amount == Decimal("-67.40")
    assert expense.description == "Albert Heijn"
    assert expense.date == date(2026, 3, 1)
    assert expense.source == "ing"

def test_ing_parses_income():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    income = next(r for r in rows if r.amount > 0)
    assert income.amount == Decimal("3460.26")

def test_ing_generates_import_hash():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    assert all(r.import_hash for r in rows)
    hashes = [r.import_hash for r in rows]
    assert len(hashes) == len(set(hashes))  # unique

def test_revolut_parses_expense():
    rows = RevolutImporter().parse(io.StringIO(REVOLUT_CSV))
    expense = next(r for r in rows if r.amount < 0)
    assert expense.amount == Decimal("-9.99")
    assert expense.description == "Spotify"
    assert expense.date == date(2026, 3, 5)
    assert expense.source == "revolut"

def test_revolut_parses_income():
    rows = RevolutImporter().parse(io.StringIO(REVOLUT_CSV))
    income = next(r for r in rows if r.amount > 0)
    assert income.amount == Decimal("500.00")

def test_revolut_skips_reverted_transactions():
    rows = RevolutImporter().parse(io.StringIO(REVOLUT_CSV))
    assert len(rows) == 2  # REVERTED top-up is excluded

def test_degiro_parses_transaction():
    rows = DEGIROImporter().parse(io.StringIO(DEGIRO_CSV))
    assert len(rows) == 1
    assert rows[0].amount == Decimal("-300.00")
    assert rows[0].description == "VWRL ETF"
    assert rows[0].date == date(2026, 3, 1)
    assert rows[0].source == "degiro"
