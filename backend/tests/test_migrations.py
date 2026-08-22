import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from db import Base, run_migrations
import models  # noqa: F401 — registers all models on Base.metadata
from models import TransactionSplit

# Pre-v2 schema: same shape as models.py minus every v2-added column
# (transactions.is_refund, transactions.standing_adjustment_id,
# transaction_splits.is_refund). Minimal but valid raw SQLite DDL.
PRE_V2_DDL = [
    """CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    type VARCHAR(9) NOT NULL,
    sort_order INTEGER
)""",
    """CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    description VARCHAR NOT NULL,
    source VARCHAR(10) NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    confirmed BOOLEAN,
    categorised_by VARCHAR(8),
    ai_confidence FLOAT,
    import_hash VARCHAR NOT NULL
)""",
    """CREATE TABLE transaction_splits (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER REFERENCES transactions(id),
    category_id INTEGER REFERENCES categories(id),
    amount NUMERIC(12, 2) NOT NULL
)""",
    "INSERT INTO categories (id, name, type) VALUES (1, 'Groceries', 'needs')",
    """INSERT INTO transactions (id, date, amount, description, source, category_id, import_hash)
VALUES (1, '2026-08-01', -250.00, 'pre-v2 shop', 'ing', NULL, 'hash-pre-v2')""",
    """INSERT INTO transaction_splits (id, transaction_id, category_id, amount)
VALUES (1, 1, 1, -125.00)""",
]


def _columns(conn, table):
    return [row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")]


@pytest.fixture
def pre_v2_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'pre-v2.db'}")
    with engine.begin() as conn:
        for statement in PRE_V2_DDL:
            conn.exec_driver_sql(statement)
    yield engine
    engine.dispose()


def test_migration_adds_is_refund_to_pre_v2_file(pre_v2_engine):
    Base.metadata.create_all(pre_v2_engine)  # no-ops for existing tables
    run_migrations(pre_v2_engine)

    with pre_v2_engine.connect() as conn:
        assert "is_refund" in _columns(conn, "transaction_splits")
        assert "is_refund" in _columns(conn, "transactions")
        # pre-existing data survives the ALTER TABLE
        row = conn.execute(text(
            "SELECT transaction_id, category_id, amount FROM transaction_splits WHERE id = 1"
        )).one()
        assert row == (1, 1, -125.0)

    # reading the legacy split row via an ORM session: flag is NULL (= inherit parent)
    Session = sessionmaker(bind=pre_v2_engine)
    session = Session()
    part = session.query(TransactionSplit).filter_by(id=1).one()
    assert part.is_refund is None
    assert part.amount == -125.00
    session.close()


def test_run_migrations_is_idempotent(pre_v2_engine):
    Base.metadata.create_all(pre_v2_engine)
    run_migrations(pre_v2_engine)
    run_migrations(pre_v2_engine)  # must not raise or duplicate columns

    with pre_v2_engine.connect() as conn:
        splits_cols = _columns(conn, "transaction_splits")
        tx_cols = _columns(conn, "transactions")
        assert splits_cols.count("is_refund") == 1
        assert tx_cols.count("is_refund") == 1
