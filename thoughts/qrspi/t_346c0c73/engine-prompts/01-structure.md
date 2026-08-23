# qrspi phase 4 (structure) — FIN-E9 pin SQLite path (kill dual data dirs)

Repo: /home/hermes/finance-tracker (work from repo root). You are implementing a small, precisely-specified change. Make ONLY the changes described below — no refactors, no drive-by cleanups. Do NOT commit; leave changes unstaged for review.

## Problem
backend/db.py line 5 defaults DATABASE_URL to "sqlite:///./data/finance.db" — CWD-relative. uvicorn started from backend/ writes backend/data/finance.db; started from repo root it uses ./data/finance.db. Two divergent DBs exist today.

## Change 1 — backend/db.py
Replace line 5 with CWD-independent default resolution:

```python
from pathlib import Path

_DEFAULT_DB = Path(__file__).resolve().parent / "data" / "finance.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB}")
```

Notes:
- Path is absolute, so f-string yields sqlite:////home/.../backend/data/finance.db (4 slashes) — valid SQLAlchemy absolute sqlite URL.
- .resolve() also makes it robust when backend itself is reached via symlink.
- Keep everything else in db.py exactly as-is (the R7 makedirs block already handles dir creation and stays correct for absolute paths).
- Add one short comment above _DEFAULT_DB explaining WHY (CWD-independent default so launch directory can never fork the database).

## Change 2 — docs truthing (old relative path references)
- SETUP.md line 66 table row: default column becomes `sqlite:////<repo>/backend/data/finance.db (absolute, resolved from the backend package dir)` and keep the description.
- SETUP.md line 166: `sqlite3 data/finance.db` → `sqlite3 backend/data/finance.db`.
- AGENTS.md line 24 tree entry: `data/finance.db` → `backend/data/finance.db`.
- AGENTS.md line 70 env-var table default cell: same replacement as SETUP.md line 66.
- README.md line 17 tree entry: same as AGENTS.md line 24.
- contracts/schema.json line 6: `"url_env": "DATABASE_URL (default sqlite:///./data/finance.db)"` → `"url_env": "DATABASE_URL (default: backend/data/finance.db, resolved absolute from the backend package dir)"`.
- Do NOT touch docs/superpowers/plans/** or thoughts/** (historical records).

## Change 3 — backend/tests/test_db_engine.py
Extend with a new test (keep the existing one untouched):

```python
def test_default_db_path_is_cwd_independent(tmp_path):
    """FIN-E9 regression guard: db.py's DEFAULT url resolves to the same
    absolute file regardless of the process working directory."""
    import db as db_module

    expected = BACKEND_DIR / "data" / "finance.db"
    observed = set()
    for cwd in (BACKEND_DIR, tmp_path):          # backend/ vs anywhere else
        result = subprocess.run(
            [sys.executable, "-c", "import db; print(db.DATABASE_URL)"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr
        observed.add(result.stdout.strip())

    assert len(observed) == 1                    # identical from every cwd
    assert f"sqlite:///{expected}" == observed.pop()
```

(Adjust import style to match the file; the probe subprocess imports db fresh with no DATABASE_URL set.)

## Constraints
- No other behaviour changes. Env override keeps winning over the default.
- Do not create/move/delete any .db file.
- Do not touch unrelated dirty files in the tree (there are parallel tasks' edits: backend/categorizer/ai.py, backend/main.py, backend/tests/test_categorizer.py, frontend/*).

## Verify (run these, report output)
1. cd /home/hermes/finance-tracker/backend && (.venv/bin/python -m pytest tests/test_db_engine.py -v 2>&1 | tail -15)
2. cd /home/hermes/finance-tracker && (cd backend && .venv/bin/python -c "import db; print(db.DATABASE_URL)") && (cd .. && backend/.venv/bin/python -B -c "import sys; sys.path.insert(0,'backend'); import db; print(db.DATABASE_URL)")
3. git status --short (confirm only intended files changed)

## Output
Print: files changed, the two DATABASE_URL prints from verify step 2 (must be identical), pytest tail, and the git status list.
