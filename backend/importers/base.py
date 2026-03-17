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

def make_hash(source: str, date: date, amount: Decimal, description: str) -> str:
    """SHA-256 hash for deduplication.

    Note: Two identical transactions on the same day (same source/date/amount/description)
    will produce the same hash and the second will be skipped on import.
    This is a known limitation for users who make duplicate purchases at the same merchant
    for the same amount on the same day.
    """
    raw = f"{source}|{date}|{amount}|{description}"
    return hashlib.sha256(raw.encode()).hexdigest()

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
