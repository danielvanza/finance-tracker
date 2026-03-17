from dataclasses import dataclass
from decimal import Decimal
from datetime import date
from typing import IO
import hashlib

@dataclass
class ParsedTransaction:
    date: date
    amount: Decimal
    description: str
    source: str
    import_hash: str

def make_hash(source: str, date: date, amount: Decimal, description: str) -> str:
    raw = f"{source}|{date}|{amount}|{description}"
    return hashlib.sha256(raw.encode()).hexdigest()

class BaseImporter:
    source: str

    def parse(self, file: IO[str]) -> list[ParsedTransaction]:
        raise NotImplementedError
