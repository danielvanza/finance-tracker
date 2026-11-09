"""Turning parsed bank rows into transactions: one path for the Import page and both chats."""
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy.orm import Session

from categorizer.ai import batch_categorise_with_ai
from categorizer.rules import apply_rules
from models import Transaction, TransactionSource

# A manual entry this many days from a bank row with the same amount looks like the same payment.
DOUBLE_ENTRY_DAYS = 7


@dataclass
class ImportOutcome:
    imported: int = 0
    skipped: int = 0
    by_rule: int = 0
    by_ai: int = 0
    uncategorised: int = 0
    new_transactions: list[Transaction] = field(default_factory=list)


def import_rows(rows: list, db: Session, cli_only: bool = False) -> ImportOutcome:
    """Add the rows not seen before: rules first (auto-confirmed), then Claude (left for review).

    With cli_only a Claude failure raises before anything is written.
    """
    outcome = ImportOutcome()
    existing_hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    ai_pending = []  # (index into new_transactions, ParsedTransaction)

    for r in rows:
        if r.import_hash in existing_hashes:
            outcome.skipped += 1
            continue
        existing_hashes.add(r.import_hash)
        tx = Transaction(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash, confirmed=False,
        )
        cat = apply_rules(r, db)
        if cat:
            tx.category_id = cat.id
            tx.confirmed = True
            tx.categorised_by = "rule"
            outcome.by_rule += 1
        else:
            ai_pending.append((len(outcome.new_transactions), r))
        outcome.new_transactions.append(tx)
        outcome.imported += 1

    if ai_pending:
        ai_results = batch_categorise_with_ai([r for _, r in ai_pending], db, cli_only=cli_only)
        for ai_idx, (tx_idx, _) in enumerate(ai_pending):
            result = ai_results.get(ai_idx)
            if result:
                cat, confidence = result
                outcome.new_transactions[tx_idx].category_id = cat.id
                outcome.new_transactions[tx_idx].ai_confidence = confidence
                outcome.new_transactions[tx_idx].categorised_by = "ai"
                outcome.by_ai += 1
            else:
                outcome.uncategorised += 1

    db.add_all(outcome.new_transactions)
    db.commit()
    return outcome


def double_entries(new_transactions: list[Transaction], db: Session) -> list[tuple[Transaction, Transaction]]:
    """(manual entry, new bank row) pairs that look like one payment. Each row is in one pair at most."""
    if not new_transactions:
        return []
    manual = db.query(Transaction).filter(
        Transaction.source == TransactionSource.manual,
        Transaction.standing_adjustment_id == None,  # noqa: E711
    ).order_by(Transaction.id).all()
    window = timedelta(days=DOUBLE_ENTRY_DAYS)
    pairs = []
    free = list(new_transactions)
    for entry in manual:
        matches = [t for t in free if t.amount == entry.amount and abs(t.date - entry.date) <= window]
        if matches:
            bank = min(matches, key=lambda t: (abs(t.date - entry.date), t.id))
            free.remove(bank)
            pairs.append((entry, bank))
    return pairs
