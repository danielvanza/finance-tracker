from datetime import date
from decimal import Decimal

from aggregate import effective_parts, spend_contribution
from models import Category, Transaction, TransactionSplit


def _categories(db):
    cat_a = Category(name="Split Refunds A", type="needs")
    cat_b = Category(name="Split Refunds B", type="wants")
    db.add_all([cat_a, cat_b])
    db.flush()
    return cat_a, cat_b


def _tx(db, amount, is_refund=False, import_hash="hash-mixed"):
    tx = Transaction(
        date=date(2026, 8, 1), amount=Decimal(amount), description="mixed basket",
        source="manual", confirmed=True, is_refund=is_refund,
        import_hash=import_hash,
    )
    db.add(tx)
    db.flush()
    return tx


def test_mixed_refund_split_aggregation(db):
    """Acceptance-critical case: parent -250 expense split into an ordinary
    part (NULL flag -> inherits parent False) and a refund part (explicit
    True); the refund part nets against spend instead of adding to it."""
    cat_a, cat_b = _categories(db)
    tx = _tx(db, "-250.00", is_refund=False, import_hash="hash-mixed-refund")
    db.add_all([
        TransactionSplit(transaction_id=tx.id, category_id=cat_a.id,
                         amount=Decimal("-125.00")),  # NULL is_refund
        TransactionSplit(transaction_id=tx.id, category_id=cat_b.id,
                         amount=Decimal("-125.00"), is_refund=True),
    ])
    db.commit()

    parts = effective_parts(tx)
    assert parts == [
        (cat_a.id, Decimal("-125.00"), False),
        (cat_b.id, Decimal("-125.00"), True),
    ]

    contrib_a = spend_contribution(parts[0][1], parts[0][2])
    contrib_b = spend_contribution(parts[1][1], parts[1][2])
    assert contrib_a == Decimal("125.00")
    assert contrib_b == Decimal("-125.00")
    assert contrib_a + contrib_b == 0  # net-zero across the two categories

    # a POSITIVE refund part must also net against spend (-abs semantics)
    assert spend_contribution(Decimal("40.00"), True) == Decimal("-40.00")


def test_unsplit_transaction_parts_unchanged(db):
    cat_a, _ = _categories(db)
    tx = _tx(db, "-80.00", is_refund=False, import_hash="hash-unsplit-expense")
    tx.category_id = cat_a.id
    db.commit()

    assert effective_parts(tx) == [(cat_a.id, Decimal("-80.00"), False)]


def test_null_part_flag_inherits_parent_true(db):
    cat_a, cat_b = _categories(db)
    tx = _tx(db, "90.00", is_refund=True, import_hash="hash-null-inherits")
    db.add_all([
        TransactionSplit(transaction_id=tx.id, category_id=cat_a.id,
                         amount=Decimal("60.00")),  # NULL -> inherit True
        TransactionSplit(transaction_id=tx.id, category_id=cat_b.id,
                         amount=Decimal("30.00")),  # NULL -> inherit True
    ])
    db.commit()

    assert effective_parts(tx) == [
        (cat_a.id, Decimal("60.00"), True),
        (cat_b.id, Decimal("30.00"), True),
    ]
