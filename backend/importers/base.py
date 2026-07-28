from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from datetime import date
from typing import IO, ClassVar
import hashlib

@dataclass
class ParsedTransaction:
    date: date
    amount: Decimal
    description: str
    source: str
    import_hash: str

def make_hash(source: str, date: date, amount: Decimal, description: str, *extra: str) -> str:
    """SHA-256 hash for deduplication.

    Each importer should pass bank-specific extra fields (e.g. notifications,
    resulting balance) to differentiate legitimate duplicate transactions that
    share the same date/amount/description.
    """
    raw = f"{source}|{date}|{amount}|{description}"
    for field in extra:
        raw += f"|{field}"
    return hashlib.sha256(raw.encode()).hexdigest()

def deduplicate_hashes(transactions: list[ParsedTransaction]) -> list[ParsedTransaction]:
    """Ensure all import_hash values in a batch are unique.

    If two rows produce the same hash (truly identical CSV rows), append an
    occurrence counter and rehash so each gets a distinct, deterministic hash.
    Re-importing the same CSV produces the same hashes in the same order.
    """
    seen: dict[str, int] = {}
    for tx in transactions:
        count = seen.get(tx.import_hash, 0)
        seen[tx.import_hash] = count + 1
        if count > 0:
            raw = f"{tx.import_hash}|{count}"
            tx.import_hash = hashlib.sha256(raw.encode()).hexdigest()
    return transactions

class BaseImporter(ABC):
    source: ClassVar[str] = ""

    def _read_content(self, file) -> str:
        """Read file-like object, str, or bytes into a str."""
        content = file.read() if hasattr(file, "read") else file
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        return content

    @abstractmethod
    def parse(self, file: IO[str]) -> list[ParsedTransaction]:
        ...
