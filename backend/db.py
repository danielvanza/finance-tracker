from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def run_migrations(engine) -> None:
    """Minimal schema upgrades for a pre-existing SQLite database.

    Base.metadata.create_all() only creates missing tables — it never alters
    existing ones, so columns added to a table after first deploy are applied
    here with ADD COLUMN.
    """
    new_columns = {
        "transactions": [
            ("is_refund", "BOOLEAN NOT NULL DEFAULT 0"),
            ("standing_adjustment_id", "INTEGER REFERENCES standing_adjustments(id)"),
        ],
        "standing_adjustments": [
            ("start_month", "DATE"),
        ],
    }
    backfills = [
        "UPDATE standing_adjustments SET start_month = date('now', 'start of month') "
        "WHERE start_month IS NULL",
    ]
    with engine.begin() as conn:
        for table, columns in new_columns.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not existing:
                continue  # table doesn't exist yet; create_all will build it complete
            for name, ddl in columns:
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        for statement in backfills:
            conn.exec_driver_sql(statement)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
