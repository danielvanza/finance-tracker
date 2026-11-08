from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")

# R7: a fresh clone has no gitignored data/ dir, so a sqlite file URL fails at
# first connect (pytest collection dies on new checkouts). Create the parent
# directory up front; skip the pure-memory forms.
if DATABASE_URL.startswith("sqlite:///"):  # excludes bare "sqlite://" memory form
    db_file = DATABASE_URL[len("sqlite:///"):]  # keeps leading "/" for absolute URLs
    db_dir = os.path.dirname(db_file)
    if db_file != ":memory:" and db_dir:
        os.makedirs(db_dir, exist_ok=True)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def run_migrations() -> None:
    """Bring the database up to the current schema via Alembic.

    Runs `alembic upgrade head` programmatically against DATABASE_URL
    (same precedence as this module's DATABASE_URL: env var, else
    sqlite:///./data/finance.db). Fresh databases are created entirely by the
    baseline revision; existing pre-Alembic databases whose schema already
    equals baseline must be registered once with `.venv/bin/alembic stamp head`.
    """
    backend_dir = Path(__file__).resolve().parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(cfg, "head")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
