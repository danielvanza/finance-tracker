# FIN-E9 structure — pin SQLite path to repo-relative location

Kanban t_346c0c73 · qrspi phase 4 (structure) · implements design.md as approved,
with the pinned D6 correction: the subprocess PROBE injects `sys.path` itself,
because the test spawns `python -c` from CWDs (notably `tmp_path`) where `db.py`
is not importable. Probe shape mirrors design.md:39:

```python
PROBE_URL = (
    f"import sys; sys.path.insert(0, r'{BACKEND_DIR}'); "
    "import db; print(db.DATABASE_URL)"
)
```

## Approach

One constant changes (`backend/db.py:5`) and everything else follows: a regression
test proves CWD-independence, docs stop describing the old relative default, and
the stale root duplicate is archived out-of-tree with recorded evidence. Three
vertical slices, each independently committable and revertible. Environment
facts confirmed for real commands: venv is `backend/.venv/bin/python`; tests run
via `.venv/bin/python -m pytest` from `backend/`; **dev.sh lives at repo root**
(`./dev.sh`, not `backend/dev.sh`) and always launches uvicorn with `cwd=backend/`,
so it needs no change; sqlite3 CLI is absent — use the venv python's `sqlite3`
module; live writer is uvicorn PID 462314 (port 8020) holding only
`backend/data/finance.db`. Do not touch parallel-task dirty files
(categorizer/ai.py, main.py, test_categorizer.py, frontend/*). One phase per
commit.

---

## Phase 1 — Code change + regression test (core vertical slice)

**Files**
- `backend/db.py` — replace line 5 with:
  `_DEFAULT_DB_FILE = (Path(__file__).resolve().parent / "data" / "finance.db")`;
  `DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB_FILE.as_posix()}")`.
  Add `from pathlib import Path` import. Guard block (db.py:7–14) untouched (D1/D3).
- `backend/tests/test_db_engine.py` — add `test_default_db_path_is_cwd_independent(tmp_path)`
  using the sys.path-injecting PROBE above (R7 test untouched). Child `env=` strips
  `DATABASE_URL`; runs subprocess twice (`cwd=BACKEND_DIR`, `cwd=tmp_path`);
  asserts both stdout values equal `sqlite:///{BACKEND_DIR}/data/finance.db`
  (4-slash absolute form).

**Verify**
```bash
cd backend && .venv/bin/python -m pytest tests/test_db_engine.py -v        # R7 + new test green
cd /tmp/opencode && /home/hermes/finance-tracker/backend/.venv/bin/python \
  -c "import sys; sys.path.insert(0,'/home/hermes/finance-tracker/backend'); import db; print(db.DATABASE_URL)"
# repeat from repo root AND from backend/ -> all three print the identical
# sqlite:////home/hermes/finance-tracker/backend/data/finance.db
```
Checkpoint: default URL identical from every CWD; override semantics unchanged;
memory forms still bypass the guard.

## Phase 2 — Documentation truth-pass

**Files**
- `README.md:19` — tree entry gains "(path pinned to backend/, CWD-independent)".
  `README.md:22` — states file lives at `backend/data/finance.db`, resolved
  absolutely regardless of launch dir; env override unchanged.
- `SETUP.md:66` — Default column becomes `` `sqlite:////<abs>/backend/data/finance.db`
  — absolute, resolved from the backend package dir ``. `SETUP.md:151` — add
  "regardless of the directory you start uvicorn from". `SETUP.md:158` — verbatim
  (already correct). `SETUP.md:166` — snippet becomes `sqlite3 backend/data/finance.db`,
  dropping its hidden `cd backend` dependency.
- `contracts/schema.json:6` — `"url_env": "DATABASE_URL (default: <repo>/backend/data/finance.db, resolved absolute from the backend package dir)"`.
- `AGENTS.md:24` and `AGENTS.md:70` — same corrections (design D6/D5 scope).

**Verify**
```bash
grep -rn 'sqlite:///\.\/data\|sqlite:///./data' README.md SETUP.md contracts/schema.json AGENTS.md backend/
# expect: only backend/db.py historical comment-free exit 0 -> i.e. NO matches outside db.py's new code
grep -n 'backend/data/finance.db' README.md SETUP.md contracts/schema.json AGENTS.md   # each doc names one truth
```
Checkpoint: no doc anywhere still advertises the CWD-relative default; docs
agree with each other and with `db.DATABASE_URL`.

## Phase 3 — Archival + cleanup evidence + live dual-CWD smoke

**Files**
- `thoughts/qrspi/t_346c0c73/cleanup.md` (new) — records: pre-move `lsof` check
  (no holder of root file), archive destination + sha256, per-table row counts of
  the ARCHIVED copy vs task.md table, rmdir confirmation.
- Filesystem (one-off script via venv python): `os.makedirs('/home/hermes/finance-db-archive', exist_ok=True)`;
  `shutil.move('data/finance.db', '/home/hermes/finance-db-archive/root-data-finance-<YYYYMMDDTHHMMSSZ>.db')`
  (UTC timestamp); then `os.rmdir('data/')`.

**Verify**
```bash
ls data/ 2>&1                                   # gone (rmdir succeeded)
/home/hermes/finance-tracker/backend/.venv/bin/python -c \
  "import sqlite3,glob; c=sqlite3.connect(glob.glob('/home/hermes/finance-db-archive/root-data-finance-*.db')[0]); [print(t, c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]) for t in ('budgets','categories','rules','settings','standing_adjustments','transaction_splits','transactions')]"
# must match task.md root column: 32/21/0/1/2/0/4 (alembic_version absent)
(cd . && DATABASE_URL= PORT=8099 timeout 8 .venv-backend-run ...)  # see below
# Dual-CWD uvicorn smoke (scratch ports, kill after ~5 s each):
#   from repo root AND from backend/:  .venv/bin/uvicorn main:app --port 8099 &
#   lsof -p <child pid> | grep finance.db   -> exactly ONE hit: backend/data/finance.db
cd backend && .venv/bin/python -m pytest        # FULL suite green
```
Checkpoint: single DB location in fact (root `data/` removed, archive persistent
outside the repo with sha256 + row-count evidence in cleanup.md); uvicorn from
either CWD opens only `backend/data/finance.db`; whole suite passes.

---

## Testing Checkpoints

| After | True statements |
|-------|----------------|
| Phase 1 | `db.DATABASE_URL` is the 4-slash absolute `sqlite:////…/backend/data/finance.db` from any CWD; `DATABASE_URL` override byte-for-byte unchanged; memory forms still skip mkdir; `tests/test_db_engine.py` (R7 + new) green. |
| Phase 2 | Zero stale `sqlite:///./data` references remain in README.md, SETUP.md, contracts/schema.json, AGENTS.md; every doc names `<repo>/backend/data/finance.db` as the one location. |
| Phase 3 | Root `data/` directory no longer exists; archived copy sits at `/home/hermes/finance-db-archive/root-data-finance-<ts>.db` (never deleted) with sha256 + row counts matching task.md recorded in cleanup.md; uvicorn launched from repo root and from backend/ both touch only `backend/data/finance.db`; full `pytest` suite green. |
