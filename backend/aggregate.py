"""Shared helpers for aggregating transactions.

Every total in the app must read *effective parts*: a split transaction
contributes its split rows instead of its parent row, and a refund part
(positive amount, is_refund) counts as negative spend on its category
rather than as income.
"""
from decimal import Decimal
from models import Transaction


def effective_parts(tx: Transaction) -> list[tuple[int | None, Decimal, bool]]:
    """Expand a transaction into (category_id, amount, is_refund) parts.

    Unsplit transactions yield a single part; split transactions yield one
    part per split row and the parent's own category/amount is ignored.
    Each part carries its OWN refund flag; a split part with NULL is_refund
    inherits the parent transaction's flag.
    """
    if tx.splits:
        return [(s.category_id, s.amount,
                 tx.is_refund if s.is_refund is None else s.is_refund)
                for s in tx.splits]
    return [(tx.category_id, tx.amount, tx.is_refund)]


def spend_contribution(amount: Decimal, is_refund: bool) -> Decimal:
    """Signed contribution to category spend. Expenses contribute -amount.
    Refunds net against spend regardless of sign: -abs(amount) (a same-sign
    negative refund part must not count as fresh spend). For every pre-v2 case
    (positive refunds, negative expenses) this equals the historic -amount."""
    return -abs(amount) if is_refund else -amount


def is_spend_part(amount: Decimal, is_refund: bool) -> bool:
    """A part counts toward category spend if it is an expense or a refund
    netting against one. Spend contribution is always -amount (refunds
    therefore reduce it, possibly below zero)."""
    return amount < 0 or is_refund
