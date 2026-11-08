# FIN-E3 — replace hand-rolled migrations with Alembic (baseline existing DBs)

Task: t_a7869011 · repo /home/hermes/finance-tracker · branch fin-v3-recurring-forecast
(direct commits, established fleet pattern).

## Problem

`backend/db.py:22-52` `run_migrations()` is a hand-rolled dict of ADD COLUMNs +
SQLite-specific backfills driven by `PRAGMA table_info` and `date('now','start of month')`.
SQLite-only, additive-only, no version tracking, silently no-ops on unknown changes.
Any non-additive change or future Postgres switch breaks it.

## Design decisions (contracts implementation builds against)

D1. **Alembic lives in `backend/alembic/`** with standard layout:
    `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`,
    `alembic/versions/<rev>_baseline.py`. `script_location = alembic`
    (relative to backend/, because alembic.ini sits in backend/).
D2. **env.py reads DATABASE_URL from the environment / .env** (same precedence as
    db.py: `os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")`) and configures
    `target_metadata = Base.metadata` with `import models  # noqa`. Offline + online
    migration paths both wired. No import of db.engine — env.py must not create a second
    engine to the app DB; it builds its own from the URL.
D3. **Baseline revision is autogen-free, hand-written** against models.py exactly:
    tables categories, transactions, transaction_splits, standing_adjustments, rules,
    budgets, settings — including R7 columns transactions.is_refund (NOT NULL
    server_default '0'), transactions.standing_adjustment_id (FK standing_adjustments.id,
    ondelete SET NULL), transaction_splits.is_refund (NULL), standing_adjustments.start_month
    (NOT NULL). Revisions down_revision=None, one revision only (`head` == baseline).
    SQLite FK semantics: SQLAlchemy renders ondelete in DDL; batch mode NOT required for
    baseline (pure CREATE TABLE).
D4. **Startup runs `alembic upgrade head` programmatically**, not shell:
    ```python
    from alembic.config import Config
    from alembic import command
    cfg = Config(str(Path(__file__).parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).parent / "alembic"))
    command.upgrade(cfg, "head")
    ```
    in db.py as `run_migrations(engine)`'s REPLACEMENT named `run_migrations() -> None`
    (keep the call-site name in main.py stable? NO — main.py:28 call becomes
    `run_migrations()`; signature drops the engine arg since env.py makes its own engine).
    `Base.metadata.create_all(bind=engine)` is REMOVED from main.py — fresh dev DBs are
    created by `upgrade head` (baseline == models.py, so result identical). Tests keep
    using `Base.metadata.create_all` directly where they build scratch engines (they don't
    go through startup); that is out of scope.
D5. **Legacy DB upgrade path**: existing finance.db predates alembic but its schema ALREADY
    equals baseline head (the old run_migrations applied every R7 column). Therefore:
    documented one-liner `cd backend && .venv/bin/alembic stamp head` marks it current;
    first `upgrade head` after stamping is a clean no-op. A pre-R7 legacy DB (missing R7
    columns) ALSO upgrades cleanly WITHOUT stamp: upgrade applies baseline DDL — but
    baseline uses CREATE TABLE which fails on existing tables. HONEST SCOPE: the supported
    path for pre-existing DBs is STAMP (schema already matches). Document stamp as THE
    required step for any existing DB; note pre-R7 DBs must first reach current schema
    (git checkout of old code ran run_migrations) before stamping. Keep it truthful in docs.
D6. **pytest dependency**: tests exercise alembic programmatically via the same
    Config/command API on scratch sqlite files in tmp_path.

## Owned / forbidden

MAY TOUCH: backend/pyproject.toml (+alembic dep), backend/alembic/** (NEW),
backend/db.py (replace run_migrations), backend/main.py (call site),
backend/tests/test_migrations.py (rewrite), README.md, SETUP.md,
thoughts/qrspi/t_a7869011/**.
MUST NOT TOUCH: models.py, schemas.py, routers/**, frontend/**, importers/**,
categorizer/**, money.py, aggregate.py, adjustments.py, spend_service.py, seed.py.

## Acceptance

A1. pytest green (full suite).
A2. Fresh empty DB comes up purely via alembic upgrade head (no create_all at startup);
    app boots, /health ok, seed works.
A3. COPY of backend/data/finance.db stamps + upgrades with rows intact (row counts equal
    before/after; data bytes untouched by stamp).
A4. Docs updated: README "no migration tool" paragraph fixed; SETUP.md 151+333 sections
    rewritten; stamp one-liner documented.
A5. merge-gate PASS.
