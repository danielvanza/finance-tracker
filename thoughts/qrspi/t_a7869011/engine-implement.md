# qrspi 7_implement — task t_a7869011 (FIN-E3 Alembic baseline)

You are executing the qrspi 7_implement phase for task t_a7869011 in this repo
(finance-tracker), branch fin-v3-recurring-forecast. The approved design lives at
thoughts/qrspi/t_a7869011/plan.md — READ IT FIRST and implement ALL of it exactly.
It defines decisions D1-D6 and acceptance A1-A5; where this prompt and plan.md
disagree, plan.md wins.

## What to build

1. Add `alembic>=1.13` to backend/pyproject.toml [project.dependencies]; pip-install
   into backend/.venv.
2. Create backend/alembic.ini + backend/alembic/env.py + backend/alembic/script.py.mako
   + backend/alembic/versions/<rev>_baseline.py. env.py reads DATABASE_URL with the same
   default as db.py ("sqlite:///./data/finance.db"), sets sqlalchemy.url accordingly,
   target_metadata = Base.metadata (import models so all tables register). Do NOT import
   db.engine or reuse db.py's engine — build your own engine from the URL inside
   run_migrations_online.
3. Baseline migration: hand-written, ONE revision, down_revision=None, creating tables
   categories, transactions, transaction_splits, standing_adjustments, rules, budgets,
   settings EXACTLY matching backend/models.py — including transactions.is_refund
   (nullable=False, server_default '0'), transactions.standing_adjustment_id FK
   standing_adjustments.id ondelete SET NULL nullable, transaction_splits.is_refund
   NULLABLE, standing_adjustments.start_month NOT NULL, active server_default '1',
   confirmed/categorised_by/sort_order/priority defaults per models, budgets
   UniqueConstraint(category_id, month), settings key String(100) PK / value String(500)
   NOT NULL. Respect every FK ondelete and nullability in models.py.
4. backend/db.py: delete the hand-rolled run_migrations(engine) body (lines 22-52);
   replace with run_migrations() -> None running "alembic upgrade head" programmatically
   via alembic.config.Config + alembic.command.upgrade, resolving alembic.ini and
   script_location relative to backend/__file__ (robust to any cwd).
5. backend/main.py lines ~27-28: remove Base.metadata.create_all(bind=engine); call
   run_migrations() with no args. Fresh dev DBs come up purely via upgrade head.
6. Rewrite backend/tests/test_migrations.py: scratch sqlite FILE DBs under tmp_path driven
   programmatically through the same Config/command API (no subprocess):
   (a) fresh empty DB -> upgrade head -> all 7 tables exist, R7 columns present
       (transactions.is_refund NOT NULL default 0, transactions.standing_adjustment_id,
       transaction_splits.is_refund nullable, standing_adjustments.start_month),
   (b) legacy path per plan.md D5: create a DB whose schema already equals baseline
       (build it by upgrading a fresh scratch DB), insert rows, then stamp head + upgrade
       head = clean no-op, rows intact; keep an ORM round-trip assertion like the old tests.
7. Docs: fix README.md (~line 20 "no migration tool is used"), SETUP.md sections near
   lines 151 and 333, AGENTS.md line 42 ("No migration tool"). Document: Alembic is now
   used; fresh DBs are migrated automatically on startup (alembic upgrade head); for an
   EXISTING database run once: cd backend && .venv/bin/alembic stamp head  (its schema
   already equals baseline; first upgrade after stamping is a no-op); pre-R7 databases
   must first reach current schema (run old code once so migrations apply) before stamping;
   new migrations go in backend/alembic/versions/.

## Scope

MAY TOUCH ONLY: backend/pyproject.toml, backend/alembic/** (new), backend/db.py,
backend/main.py, backend/tests/test_migrations.py, README.md, SETUP.md, AGENTS.md,
thoughts/qrspi/t_a7869011/**.
MUST NOT TOUCH: models.py, schemas.py, routers/**, frontend/**, importers/**,
categorizer/**, money.py, aggregate.py, adjustments.py, spend_service.py, seed.py.

## Verify before finishing (all must pass)

- cd backend && .venv/bin/pip install -e '.[dev]' -q && .venv/bin/python -m pytest -q
  (full suite green)
- rm -f /tmp/fresh-e3.db && DATABASE_URL=sqlite:////tmp/fresh-e3.db .venv/bin/python -c "import main"
  then dump table list of /tmp/fresh-e3.db -> must be all 7 tables + alembic_version
  (no create_all involved).
- cp data/finance.db /tmp/legacy-e3.db ; row-count all 7 tables before ;
  cd backend && DATABASE_URL=sqlite:////tmp/legacy-e3.db .venv/bin/alembic stamp head ;
  DATABASE_URL=sqlite:////tmp/legacy-e3.db .venv/bin/alembic upgrade head ;
  row-count after -> identical, and alembic_version shows head revision.
- git add ONLY the touched owned files and COMMIT:
  feat(db): replace hand-rolled migrations with Alembic baseline (t_a7869011)

## Report back

Files changed, commit sha, pytest tail output, fresh-DB table list, legacy row-count
comparison result.
