from dataclasses import dataclass
from decimal import Decimal
from datetime import date
import hashlib

@dataclass
class ParsedTransaction:
    date: date
    amount: Decimal
    description: str
    source: str
    import_hash: str
    note: str = ""  # what the bank wrote with the payment, as it stands in the file

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
