from decimal import Decimal
from datetime import date
from importers.ing import parse_ing

ING_CSV = """"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"
"20260301";"Albert Heijn";"NL57INGB0000000000";"";"BA";"Debit";"67,40";"Payment terminal";"";"";"";""
"20260302";"Salaris Bedrijf BV";"NL57INGB0000000000";"NL00INGB0002222222";"GT";"Credit";"3460,26";"Online Banking";"Maandloon";"";"";""
"""


def test_ing_parses_expense():
    rows = parse_ing(ING_CSV)
    expense = next(r for r in rows if r.amount < 0)
    assert expense.amount == Decimal("-67.40")
    assert expense.description == "Albert Heijn"
    assert expense.date == date(2026, 3, 1)
    assert expense.source == "ing"

def test_ing_parses_income():
    rows = parse_ing(ING_CSV)
    income = next(r for r in rows if r.amount > 0)
    assert income.amount == Decimal("3460.26")

def test_ing_generates_import_hash():
    rows = parse_ing(ING_CSV)
    assert all(r.import_hash for r in rows)
    hashes = [r.import_hash for r in rows]
    assert len(hashes) == len(set(hashes))  # unique
