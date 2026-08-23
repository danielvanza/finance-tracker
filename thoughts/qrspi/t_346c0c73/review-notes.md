# Reviewer notes for /qrspi/5_plan (t_346c0c73)

Fold these into plan.md. They are reviewer decisions, not suggestions.

## Correction A — dual-CWD uvicorn smoke must be fully literal
structure.md line 95 contains a garbled pseudo-command; replace with literal steps.
VERIFIED FACT: bare `backend/.venv/bin/python -m uvicorn main:app` from repo root FAILS
("Could not import module main" — probed live during planning). The root-CWD leg needs
PYTHONPATH=backend, e.g. from repo root:
    PYTHONPATH=backend backend/.venv/bin/python -m uvicorn main:app --port 8099 &
then sleep 3, pgrep -f 'uvicorn main:app --port 8099' (note: exclude harness shells),
lsof -p <pid> | grep finance.db -> expect EXACTLY one line: backend/data/finance.db,
kill <pid>. Second leg identical but launched from inside backend/ on port 8098
(no PYTHONPATH needed there).

## Correction B — keep the sys.path-injecting PROBE_URL
Test snippet must use the PROBE_URL form from structure.md lines 8-13
(BACKEND_DIR interpolated at module level), NOT a bare `import db` probe.

## Verified environment facts (already confirmed live — cite as-is)
- Tests: cd backend && .venv/bin/python -m pytest  (baseline today: 194 passed)
- sqlite3 CLI absent on host; use .venv python's sqlite3 module.
- Live uvicorn pid 462314, port 8020, holds ONLY backend/data/finance.db.
  Leave it running. Scratch ports for smokes: 8099 (root CWD) and 8098 (backend CWD).
- dev.sh is at repo ROOT and launches uvicorn with cwd=backend/ — needs no change.
