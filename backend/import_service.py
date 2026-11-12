"""Turning parsed bank rows into transactions: one path for the Import page and both chats."""
from collections import Counter
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy.orm import Session

import guesses
import money
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
    by_ai: int = 0  # Claude was sure: counted at once
    doubtful: int = 0  # Claude was not sure: waiting for an answer
    uncategorised: int = 0
    noted: int = 0  # rows already here that got the bank's note they were imported without
    new_transactions: list[Transaction] = field(default_factory=list)


def already_here(rows: list, db: Session) -> list[bool]:
    """For each parsed row, whether the payment is in the database already.

    The same export imported twice matches by its hash. The same payment from an export in the other
    language has other wording in its notes and so another hash; it is recognised by date, amount and
    name, one existing row answering for one row of the file.
    """
    hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    key = lambda day, amount, description: (day, money.to_cents(amount), description)  # noqa: E731
    stored = Counter(
        key(*row) for row in db.query(Transaction.date, Transaction.amount, Transaction.description)
        .filter(Transaction.source == TransactionSource.ing).all()
    )
    here = [r.import_hash in hashes for r in rows]
    for r, known in zip(rows, here):
        if known and stored[key(r.date, r.amount, r.description)] > 0:
            stored[key(r.date, r.amount, r.description)] -= 1
    for i, r in enumerate(rows):
        if not here[i] and stored[key(r.date, r.amount, r.description)] > 0:
            stored[key(r.date, r.amount, r.description)] -= 1
            here[i] = True
    return here


def import_rows(rows: list, db: Session, cli_only: bool = False) -> ImportOutcome:
    """Add the rows not seen before: rules first, then Claude, whose sure guesses count at once and
    whose doubtful ones wait for an answer. A row that is here already without its bank note gets it.

    With cli_only a Claude failure raises before anything is written.
    """
    outcome = ImportOutcome()
    ai_pending = []  # (index into new_transactions, ParsedTransaction)

    noteless = {
        t.import_hash: t for t in db.query(Transaction).filter(Transaction.note.is_(None)).all()
    } if any(r.note for r in rows) else {}

    for r, known in zip(rows, already_here(rows, db)):
        if known:
            outcome.skipped += 1
            earlier = noteless.get(r.import_hash)
            if earlier is not None and r.note:
                earlier.note = r.note
                outcome.noted += 1
            continue
        tx = Transaction(
            date=r.date, amount=r.amount, description=r.description, note=r.note or None,
            source=r.source, import_hash=r.import_hash, confirmed=False,
        )
        cat = apply_rules(r, db)
        if cat:
            tx.category_id = cat.id
            tx.confirmed = True
            tx.categorised_by = "rule"
            tx.ai_options = []
        else:
            ai_pending.append((len(outcome.new_transactions), r))
        outcome.new_transactions.append(tx)
        outcome.imported += 1

    if ai_pending:
        ai_results = batch_categorise_with_ai([r for _, r in ai_pending], db, cli_only=cli_only)
        asked = guesses.ask_shops(db)
        for ai_idx, (tx_idx, _) in enumerate(ai_pending):
            guess = ai_results.get(ai_idx)
            if guess:
                guesses.take_guess(outcome.new_transactions[tx_idx], guess, asked)

    db.add_all(outcome.new_transactions)
    db.flush()
    guesses.sort_personal(db, outcome.new_transactions)
    for tx in outcome.new_transactions:
        if tx.categorised_by == "rule":
            outcome.by_rule += 1
        elif tx.categorised_by == "ai" and tx.confirmed:
            outcome.by_ai += 1
        elif tx.categorised_by == "ai":
            outcome.doubtful += 1
        else:
            outcome.uncategorised += 1
    db.commit()
    return outcome


def double_entries(new_transactions: list[Transaction], db: Session) -> list[tuple[Transaction, Transaction]]:
    """(manual entry, new bank row) pairs that look like one payment. Each row is in one pair at most."""
    if not new_transactions:
        return []
    manual = db.query(Transaction).filter(
        Transaction.source == TransactionSource.manual,
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
