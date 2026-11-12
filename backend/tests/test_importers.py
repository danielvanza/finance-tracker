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


def test_ing_keeps_the_note():
    rows = parse_ing(ING_CSV)
    assert [r.note for r in rows] == ["", "Maandloon"]


def test_written_is_what_the_payer_typed():
    from importers.ing import written

    assert written("Name: J Jansen Description: Terug voor vliegtickets IBAN: NL00INGB0000000000 Value date: 05/09/2026") == "Terug voor vliegtickets"
    assert written("Naam: J Jansen Omschrijving: Geld terug vliegtickets IBAN: NL00INGB0000000000 Datum/Tijd: 05-09-2026 12:34:56 Valutadatum: 05-09-2026") == "Geld terug vliegtickets"
    assert written("Name: Energie BV Description: Factuur 123 IBAN: NL00INGB0000000000 Reference: 99 Mandate ID: M1 Creditor ID: C1 Recurrent SEPA direct debit Value date: 05/09/2026") == "Factuur 123"
    assert written("Card sequence no.: 001 05/09/2026 12:34 Transaction: A1B2C3 Term: AB1234 Apple Pay Value date: 06/09/2026") == ""
    assert written("Pasvolgnr: 001 05-09-2026 12:34 Transactie: A1B2C3 Term: AB1234 Valutadatum: 06-09-2026") == ""
    assert written("Maandloon") == "Maandloon"
    assert written("To Oranje spaarrekening N12345 Value date: 01/09/2026") == "To Oranje spaarrekening N12345"
    assert written("Name: J Jansen Description: Bedankt") == "Bedankt"
    assert written(None) == "" and written("") == ""
