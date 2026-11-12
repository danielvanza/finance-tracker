"""ING current-account exports, with English or Dutch column names, separated by semicolons or commas."""
import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from .base import ParsedTransaction, deduplicate_hashes, make_hash

# What each column is called in an English and in a Dutch export.
_COLUMNS = {
    "date": ("date", "datum"),
    "name": ("name / description", "naam / omschrijving"),
    "direction": ("debit/credit", "af bij"),
    "amount": ("amount (eur)", "bedrag (eur)"),
    "notifications": ("notifications", "mededelingen"),
    "balance": ("resulting balance", "saldo na mutatie"),
}
_REQUIRED = ("date", "name", "direction", "amount")
_OUT, _IN = ("debit", "af"), ("credit", "bij")
_AMOUNT = re.compile(r"\d+([.,]\d{1,2})?")


class BadFile(Exception):
    """Not a usable ING export. The message finishes the sentence "That file could not be used because …"."""


def _rows(text: str) -> list[dict[str, str]]:
    """Each row keyed by what the column means, whichever language the file is in."""
    first_line = text.split("\n", 1)[0]
    delimiter = ";" if first_line.count(";") >= first_line.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = [h.strip().strip('"').lower() for h in next(reader, [])]
    where = {}
    for meaning, names in _COLUMNS.items():
        found = [i for i, h in enumerate(header) if h in names]
        if found:
            where[meaning] = found[0]
    if not all(meaning in where for meaning in _REQUIRED):
        raise BadFile("it does not have the columns of an ING export")
    rows = []
    for cells in reader:
        row = {meaning: (cells[i].strip().strip('"') if i < len(cells) else "") for meaning, i in where.items()}
        if not row["date"]:
            if any(cell.strip() for cell in cells):
                raise BadFile("some of its rows could not be read")
            continue
        rows.append(row)
    return rows


def parse_ing(content: bytes | str) -> list[ParsedTransaction]:
    """The file's payments, or BadFile if it is not an ING export with at least one row."""
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise BadFile("it is not a text file") from None
    else:
        content = content.lstrip("﻿")
    results = []
    try:
        for row in _rows(content):
            direction = row["direction"].lower()
            if direction not in _OUT + _IN or not _AMOUNT.fullmatch(row["amount"]):
                raise BadFile("some of its rows could not be read")
            day = datetime.strptime(row["date"], "%Y%m%d").date()
            amount = Decimal(row["amount"].replace(",", "."))
            if direction in _OUT:
                amount = -amount
            results.append(ParsedTransaction(
                date=day, amount=amount, description=row["name"], source="ing",
                import_hash=make_hash("ing", day, amount, row["name"], row.get("notifications", ""), row.get("balance", "")),
            ))
    except (ValueError, InvalidOperation, csv.Error):
        raise BadFile("some of its rows could not be read") from None
    if not results:
        raise BadFile("it has no transactions in it")
    return deduplicate_hashes(results)
