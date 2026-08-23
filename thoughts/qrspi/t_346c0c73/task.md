# FIN-E9: pin SQLite path to repo-relative location (kill dual data dirs)

Kanban task t_346c0c73 · parent t_f31403bd · finance-tracker

## Problem
Two divergent SQLite files exist:
- /home/hermes/finance-tracker/data/finance.db        (61,440 B, mtime 16:40)
- /home/hermes/finance-tracker/backend/data/finance.db (69,632 B, mtime 16:39)

backend/db.py line 5: `DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")`
— CWD-dependent. uvicorn started from backend/ writes backend/data/, started from repo root writes ./data/.

## Verified ground truth (2026-08-23, fresh row counts)

| table                | data/ (root) | backend/data/ |
|----------------------|-------------|---------------|
| alembic_version      | 0 (absent)  | 1             |
| budgets              | 32          | 64            |
| categories           | 21          | 22            |
| rules                | 0           | 0             |
| settings             | 1           | 1             |
| standing_adjustments | 2           | 2             |
| transaction_splits   | 0           | 0             |
| transactions         | 4           | 7             |

- Live writer: uvicorn PID 462314 (port 8020) holds ONLY backend/data/finance.db open (lsof evidence).
- Canonical DB = **backend/data/finance.db** (superset on every table).
- Stale duplicate = data/finance.db at repo root.
- Both gitignored (.gitignore line `data/` matches both).
- sqlite3 CLI is NOT installed on this host — use python3 + sqlite3 module for any DB inspection.

## Build requirements (from ticket)
1. Make DATABASE_URL resolution CWD-independent: default resolves relative to the backend package
   dir (`Path(__file__).resolve().parent / "data" / "finance.db"`) unless DATABASE_URL env var overrides.
2. One-time cleanup: archive the stale ROOT data/finance.db out of the repo tree (do NOT delete
   silently); report row counts in the task comment.
3. Update SETUP.md / README.md paths that mention the old relative path
   (SETUP.md:66, SETUP.md:151, SETUP.md:158, SETUP.md:166, README.md:19, README.md:22,
   contracts/schema.json:6 all reference the old default).

## Tests
backend/tests/test_db_engine.py exists (R7 guard, subprocess-based because db.py reads env at
import time). Extend with a case asserting the DEFAULT url resolves identically regardless of CWD.

## Acceptance
- pytest green
- starting uvicorn from repo root vs backend/ lands on the SAME file
- stale duplicate archived with row-count evidence in a task comment
