You are executing the FINAL qrspi implement phase in /home/hermes/finance-tracker (work there).

Read first:
- thoughts/qrspi/t_cbc05e98/plan.md ← working doc; execute ONLY Phase P3 (as amended below), then stop.
- backend/db.py, backend/main.py, backend/tests/conftest.py

HARD BOUNDARIES: you may edit ONLY backend/db.py and backend/tests/**. Never touch routers/,
models.py, schemas.py, aggregate.py, money.py, frontend/, importers/, categorizer/.
Commit at the end starting "B1 P3:". One-shot identity flags as before
(`git -c user.name="danielvanza" -c user.email="daniel.van.ziel7@gmail.com"`); never touch git
config; never stage untracked contracts/, design/, thoughts/.

## What P3 delivers

### 1. db.py — R7 micro-fix (SMALL, isolated)
Before the module-level `engine = create_engine(...)`, add: when DATABASE_URL starts with
"sqlite:///" (and is not ":memory:" / "sqlite://" pure-memory form), extract the file path,
os.makedirs(os.path.dirname(...), exist_ok=True) so a fresh clone without the gitignored
backend/data/ dir can import db.py (pytest collection currently fails on fresh clones).
Keep it ~5 lines, commented. Nothing else in db.py changes.

### 2. New test proving R7 (backend/tests/test_db_engine.py)
A test that imports db.py machinery with DATABASE_URL pointed at a NON-existent nested dir
under tmp_path (e.g. set os.environ BEFORE importing db via importlib.reload or subprocess)
and asserts the directory gets created and an engine/session can execute SELECT 1.
Simplest robust approach: run a tiny python subprocess with env DATABASE_URL=sqlite:///{tmp}/x/y/probe.db -c "import db; s=db.SessionLocal(); print(s.execute(text('SELECT 1')).scalar())"
from the backend cwd, assert exit 0 and output contains 1.

### Verification (LIVE — run each yourself, report real output)
1. Fresh-clone simulation from repo root:
   `cd /tmp && rm -rf b1fresh && cp -r /home/hermes/finance-tracker/b1fresh-sim . 2>/dev/null;`
   Simpler: `cd /home/hermes/finance-tracker/backend && rm -rf /tmp/fresh-data && DATABASE_URL=sqlite:////tmp/fresh-data/nested/fresh.db timeout 120 .venv/bin/python -m pytest -q`
   → must be ALL green WITHOUT any manual mkdir (this is the R7 proof).
2. Real-DB migration probe (read-only against the real DB): copy backend/data/finance.db to
   /tmp/fin-live-copy.db, then python: create_engine(sqlite:////tmp/fin-live-copy.db),
   Base.metadata.create_all + run_migrations, then PRAGMA table_info(transaction_splits) →
   assert/print that is_refund exists; print row counts of transactions/splits before+after to
   show nothing lost. NEVER touch backend/data/finance.db itself.
3. Wire probes with TestClient(main.app) in one python snippet:
   - GET /standing-adjustments → every amount_cents is int.
   - POST /import/preview with a tiny inline CSV (source=ing) → rows[].amount_cents all ints;
     print them. (Check tests/test_importers.py for a valid ing CSV sample first.)
   - GET /health → {"status": "ok"}.
   NOTE: TestClient(main.app) uses backend/data/finance.db via the real engine — it ALREADY
   EXISTS here, fine. Do not create/delete DBs.
4. Full `.venv/bin/python -m pytest -q` → report exact count.
5. Commit owned files only: "B1 P3: lazy sqlite dir creation (R7 fresh clones) + live verification".
6. DO NOT push, DO NOT run the merge gate — the orchestrator does those.

Report back: files changed, pytest count, outputs of steps 1–4 verbatim-ish, commit sha.
If code contradicts this brief, STOP and report instead of improvising.
