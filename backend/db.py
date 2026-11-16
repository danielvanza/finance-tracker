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


def bot_store_path(database_file: str | None = None) -> Path:
    """The chat's own SQLite file (the bot kit's store): BOT_DB_PATH, else `bot.db` beside the finance database.

    `database_file` is the finance database's file (the migration passes the one it runs on); by default the one
    DATABASE_URL names.
    """
    explicit = os.getenv("BOT_DB_PATH")
    if explicit:
        return Path(explicit)
    if database_file is None and DATABASE_URL.startswith("sqlite:///"):
        database_file = DATABASE_URL[len("sqlite:///"):]
    if not database_file or database_file == ":memory:":
        return Path("data") / "bot.db"
    return Path(database_file).parent / "bot.db"

def run_migrations() -> None:
    """Bring the database up to the current schema via Alembic.

    Runs `alembic upgrade head` programmatically against DATABASE_URL
    (same precedence as this module's DATABASE_URL: env var, else
    sqlite:///./data/finance.db). Fresh databases are created by the baseline
    revision and the ones after it; a database from before Alembic, whose schema
    equals the baseline, must be registered once with
    `.venv/bin/alembic stamp afe0635828ba`.
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
