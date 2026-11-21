"""Files made in the chat: a lookup's rows as a spreadsheet the household can open.

The file is a CSV that opens as it should in Dutch Excel, Numbers and Google Sheets: UTF-8 with a byte order mark
(so Excel reads the accents), semicolons between the columns (Excel in a Dutch setting splits on them), every
*_cents column as euros with a decimal comma (its header then ends in _eur), and dates as YYYY-MM-DD. A file is kept
30 days, so its link in the chat keeps working that long; making a new one clears out the older ones.
"""
import csv
import io
import re
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

import clock
from models import Export

KEEP_DAYS = 30
MAX_NAME = 60
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def clean_filename(name: str | None) -> str:
    """Plain words for a file name: no folders, no odd characters, at most MAX_NAME long, ending in .csv."""
    stem = re.sub(r"\.csv$", "", (name or "").strip(), flags=re.IGNORECASE)
    stem = stem.replace("/", " ").replace("\\", " ")
    stem = re.sub(r"[^\w\- ]+", " ", stem)  # letters (any language), digits, _, - and spaces
    stem = re.sub(r"\s+", " ", stem).strip(" -_.")[:MAX_NAME].strip(" -_.")
    return f"{stem or 'export'}.csv"


def header(column: str) -> str:
    """A column's name in the file: *_cents becomes *_eur."""
    return column[: -len("_cents")] + "_eur" if column.endswith("_cents") else column


def _euros(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        try:
            value = float(value.replace(",", "."))
        except ValueError:
            return value
    cents = round(value)
    sign = "-" if cents < 0 else ""
    whole, rest = divmod(abs(cents), 100)
    return f"{sign}{whole},{rest:02d}"


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        return repr(round(value, 4)).replace(".", ",").removesuffix(",0")
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == datetime.min.time() else value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes):
        return ""
    text = str(value)
    # Text from a bank description could start like a formula; a spreadsheet must show it, not run it.
    return "'" + text if text.startswith(_FORMULA_START) else text


def to_csv(columns: list[str], rows: list[tuple | list]) -> bytes:
    """The rows as a CSV for a Dutch spreadsheet (see the module's docstring)."""
    money = [column.endswith("_cents") for column in columns]
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow([header(column) for column in columns])
    for row in rows:
        writer.writerow([_euros(value) if is_money else _cell(value) for value, is_money in zip(row, money)])
    return out.getvalue().encode("utf-8-sig")


def save(db: Session, filename: str, content: bytes) -> Export:
    """Keep a new file, and clear out the ones older than KEEP_DAYS."""
    now = clock.now()
    db.query(Export).filter(Export.created_at < now - timedelta(days=KEEP_DAYS)).delete(synchronize_session=False)
    export = Export(filename=clean_filename(filename), content=content, created_at=now)
    db.add(export)
    db.commit()
    db.refresh(export)
    return export
