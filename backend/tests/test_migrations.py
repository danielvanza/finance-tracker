"""Alembic migration tests (FIN-E3).

Drives the same alembic Config/command API that db.run_migrations() uses at
startup, against scratch sqlite FILE databases under tmp_path — no subprocess,
no reuse of db.engine.
"""

import sqlite3
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]

BASELINE_TABLES = {
    "categories",
    "transactions",
    "transaction_splits",
    "set_asides",
    "ignored_bills",
    "rules",
    "budgets",
    "settings",
}


def _alembic_config(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def _head_revision(cfg: Config) -> str:
    return ScriptDirectory.from_config(cfg).get_current_head()


@pytest.fixture
def scratch_db(tmp_path, monkeypatch) -> Path:
    """Scratch sqlite file DB; DATABASE_URL points every alembic command at it."""
    db_path = tmp_path / "scratch.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    return db_path


def _table_names(db_path: Path) -> set[str]:
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        return {row[0] for row in rows}
    finally:
        con.close()


def _table_info(db_path: Path, table: str) -> dict[str, tuple]:
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(f"PRAGMA table_info({table})").fetchall()
        return {row[1]: row for row in rows}
    finally:
        con.close()


def _foreign_keys(db_path: Path, table: str) -> dict[str, tuple]:
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(f"PRAGMA foreign_key_list({table})").fetchall()
        return {row[3]: row for row in rows}
    finally:
        con.close()


def _row_counts(db_path: Path) -> dict[str, int]:
    con = sqlite3.connect(db_path)
    try:
        return {
            table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in sorted(BASELINE_TABLES)
        }
    finally:
        con.close()


def _version_row(db_path: Path) -> str:
    con = sqlite3.connect(db_path)
    try:
        return con.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    finally:
        con.close()


def test_fresh_upgrade_creates_baseline_schema(scratch_db):
    cfg = _alembic_config(scratch_db)
    command.upgrade(cfg, "head")

    assert _table_names(scratch_db) == BASELINE_TABLES | {"alembic_version", "chat_messages", "chat_proposals", "ask_shops"}
    assert _version_row(scratch_db) == _head_revision(cfg)

    # R7 columns, exactly as models.py declares them.
    tx = _table_info(scratch_db, "transactions")
    assert tx["is_refund"][1:4] == ("is_refund", "BOOLEAN", 1)  # NOT NULL
    assert tx["is_refund"][4] == "'0'"  # server default 0
    assert "standing_adjustment_id" not in tx
    assert tx["set_aside_id"][3] == 0  # nullable

    splits = _table_info(scratch_db, "transaction_splits")
    assert splits["is_refund"][1:4] == ("is_refund", "BOOLEAN", 0)  # nullable

    bills = _table_info(scratch_db, "set_asides")
    assert bills["start_month"][3] == 1  # NOT NULL
    assert bills["every_months"][1:4] == ("every_months", "INTEGER", 0)  # nullable: once
    assert "yearly" not in bills

    # FK ondelete semantics.
    tx_fks = _foreign_keys(scratch_db, "transactions")
    assert tx_fks["set_aside_id"][2:3] == ("set_asides",)
    assert tx_fks["set_aside_id"][6] == "SET NULL"
    split_fks = _foreign_keys(scratch_db, "transaction_splits")
    assert split_fks["transaction_id"][6] == "CASCADE"
    assert split_fks["category_id"][6] == "SET NULL"

    # Budget uniqueness: (category_id, month). UNIQUE constraints surface as
    # auto-indexes with NULL sql text, so inspect via index_list/index_info.
    con = sqlite3.connect(scratch_db)
    try:
        unique_col_sets = set()
        for idx_row in con.execute("PRAGMA index_list('budgets')").fetchall():
            if idx_row[2]:  # "unique" flag
                cols = tuple(
                    r[2] for r in con.execute(f"PRAGMA index_info('{idx_row[1]}')").fetchall()
                )
                unique_col_sets.add(cols)
        assert ("category_id", "month") in unique_col_sets
    finally:
        con.close()

    # Settings key/value shapes.
    settings = _table_info(scratch_db, "settings")
    assert settings["key"][2].upper().startswith("VARCHAR(100)")
    assert settings["key"][5] == 1  # primary key
    assert settings["value"][3] == 1  # NOT NULL


def test_yearly_set_asides_become_every_twelve_months(scratch_db):
    cfg = _alembic_config(scratch_db)
    command.upgrade(cfg, "d2f8a6c31e75")
    con = sqlite3.connect(scratch_db)
    con.executemany(
        "INSERT INTO set_asides (name, amount, start_month, due_month, yearly) VALUES (?, 100, '2026-11-01', '2027-01-01', ?)",
        [("Insurance", 1), ("Holiday", 0)],
    )
    con.commit()
    con.close()

    command.upgrade(cfg, "head")
    con = sqlite3.connect(scratch_db)
    rows = dict(con.execute("SELECT name, every_months FROM set_asides").fetchall())
    con.close()
    assert rows == {"Insurance": 12, "Holiday": None}

    command.downgrade(cfg, "d2f8a6c31e75")
    con = sqlite3.connect(scratch_db)
    rows = dict(con.execute("SELECT name, yearly FROM set_asides").fetchall())
    con.close()
    assert rows == {"Insurance": 1, "Holiday": 0}


def test_stamp_makes_existing_schema_upgrade_a_noop(scratch_db):
    from models import (
        Budget,
        Category,
        Rule,
        Setting,
        Transaction,
        TransactionSplit,
        CategoryType,
        TransactionSource,
    )

    # Legacy path per plan D5: build a DB whose schema already equals baseline
    # (upgrade a fresh scratch DB), insert rows, then register it with stamp.
    cfg = _alembic_config(scratch_db)
    command.upgrade(cfg, "head")

    engine = create_engine(f"sqlite:///{scratch_db}")
    Session = sessionmaker(bind=engine)
    session = Session()
    category = Category(name="Groceries", type=CategoryType.needs, sort_order=0)
    session.add(category)
    session.flush()
    session.add(
        Transaction(
            date=date(2026, 8, 1),
            amount=Decimal("-250.00"),
            description="legacy shop",
            source=TransactionSource.ing,
            category_id=category.id,
            confirmed=True,
            import_hash="hash-legacy-1",
        )
    )
    session.add(
        TransactionSplit(transaction_id=1, category_id=category.id, amount=Decimal("-125.00"))
    )
    session.add(Rule(pattern="legacy", category_id=category.id))
    session.add(Budget(category_id=category.id, month=None, planned_amount=Decimal("300.00")))
    session.add(Setting(key="theme", value="dark"))
    session.commit()

    before = _row_counts(scratch_db)
    assert before == {
        "budgets": 1,
        "categories": 1,
        "rules": 1,
        "settings": 1,
        "set_asides": 0,
        "ignored_bills": 0,
        "transaction_splits": 1,
        "transactions": 1,
    }

    command.stamp(cfg, "head")
    assert _version_row(scratch_db) == _head_revision(cfg)

    # First upgrade after stamping: clean no-op, rows intact.
    command.upgrade(cfg, "head")
    assert _row_counts(scratch_db) == before
    assert _version_row(scratch_db) == _head_revision(cfg)

    # ORM round-trip over the surviving legacy rows (like the old tests).
    part = session.query(TransactionSplit).filter_by(id=1).one()
    assert part.is_refund is None  # NULL = inherit parent
    assert part.amount == Decimal("-125.00")
    tx = session.get(Transaction, 1)
    assert tx.description == "legacy shop"
    assert tx.is_refund is False
    assert tx.set_aside_id is None
    session.close()
    engine.dispose()
