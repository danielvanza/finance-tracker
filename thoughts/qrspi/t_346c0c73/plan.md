# FIN-E9 plan — pin SQLite path to repo-relative location

Kanban t_346c0c73 · parent t_f31403bd · qrspi phase 5 (plan) · expands structure.md
(design-approved) into an executable, self-contained implementation plan.

## Overview

One constant changes: `backend/db.py:5` currently defaults
`DATABASE_URL` to the CWD-relative `"sqlite:///./data/finance.db"`, so uvicorn
launched from `backend/` writes `backend/data/finance.db` while a launch from
repo root writes `./data/finance.db`. Two divergent databases exist (task.md
ground truth: canonical superset = `backend/data/finance.db`, held open by live
uvicorn PID 462314 on port 8020; stale 4-transaction duplicate = root
`data/finance.db`). This plan makes the default resolve absolutely from the
backend package dir (`Path(__file__).resolve().parent`), proves CWD-independence
with a regression test, corrects every doc that advertises the old relative
default, archives the stale root copy outside the repo with recorded evidence,
and finishes with a live dual-CWD uvicorn smoke proving both launch styles open
only `backend/data/finance.db`.

Three vertical slices, one commit per phase, each independently revertible:

1. Code change + regression test (`backend/db.py`, `backend/tests/test_db_engine.py`)
2. Documentation truth-pass (README.md, SETUP.md, contracts/schema.json, AGENTS.md)
3. Archival + cleanup evidence + live dual-CWD smoke (+ full suite)

### Verified environment facts (2026-08-23, probed live during planning)

- Venv interpreter: `backend/.venv/bin/python`. Tests: `cd backend` then
  `.venv/bin/python -m pytest` — **baseline today: 194 passed**.
- **sqlite3 CLI is NOT installed** — use the venv python's `sqlite3` module for
  any DB inspection (all steps below already comply).
- Live writer: uvicorn **PID 462314, port 8020**, holds ONLY
  `/home/hermes/finance-tracker/backend/data/finance.db` (inodes confirm one
  file, multiple fds). **Leave it running.** Smokes use scratch ports
  **8099** (root-CWD variant) and **8098** (backend-CWD variant) — verified free.
- `./dev.sh` lives at repo root and always launches uvicorn with
  `cwd=backend/` — **needs no change**; after Phase 1 both launch styles are
  equivalent by construction.
- `lsof` and `pgrep` exist at `/usr/bin/`. `/tmp/opencode/` exists (scratch).
- Archive dir `/home/hermes/finance-db-archive` does NOT exist yet (Phase 3 creates it).

### Two hazards probed during planning (baked into Phase 3 commands)

1. **Repo-root uvicorn launch needs `PYTHONPATH`.** There is no `main.py` at
   repo root; the bare pinned form fails there with
   `ERROR: Could not import module "main."` (reproduced live). The root-CWD
   smoke therefore prefixes `PYTHONPATH=/home/hermes/finance-tracker/backend`,
   keeping the pinned binary/app/port arguments byte-identical. This faithfully
   reproduces the historical bug scenario (launch from repo root).
2. **`pgrep -f 'uvicorn main:app --port 80NN'` self-matches fleet harness
   shells.** Observed live: pgrep returned 4 PIDs, three of which were bash/
   opencode harness processes carrying the pattern in their argv. Mitigation:
   the server PID is captured authoritatively with `$!` at launch; the pinned
   pgrep expression is kept verbatim as a *containment assertion*
   (`pgrep -f '<pinned>' | grep -qx "$SERVER_PID"`). Smokes run from script
   files under `/tmp/opencode/`, never inline, so the caller's own argv cannot
   pollute results.

### Ground-truth correction recorded for Phase 3 (read before archiving)

task.md lists root `alembic_version` as *absent*. During plan validation a
root-CWD uvicorn probe ran app startup (create_all + migrations) against the
stale copy, creating an **empty `alembic_version` table (0 rows)**. All domain
row counts are UNCHANGED and were re-verified today against the live root file:
budgets 32, categories 21, rules 0, settings 1, standing_adjustments 2,
transaction_splits 0, transactions 4. Phase 3 expectations below pin this
post-probe reality; cleanup.md records the provenance note.

---

## Phase 1 — Code change + regression test (core slice)

**Commit when green:** `fix(db): resolve default DATABASE_URL relative to backend package dir (FIN-E9)`

### Changes

#### File `backend/db.py`

Replace lines 1–5 exactly. Before:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")
```

After:

```python
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

_DEFAULT_DB_FILE = Path(__file__).resolve().parent / "data" / "finance.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB_FILE.as_posix()}")
```

Resulting default URL:
`sqlite:////home/hermes/finance-tracker/backend/data/finance.db`
(four leading slashes = SQLAlchemy absolute-sqlite form).

Do NOT touch anything below line 5: the R7 mkdir guard (db.py:7–14) already
handles absolute URLs (leading `/` survives the `"sqlite:///"` strip), bare
`sqlite://`, and `:memory:` — design D1/D3, zero edits. Do NOT touch
`run_migrations` or `get_db`.

#### File `backend/tests/test_db_engine.py`

Append below the existing `test_import_creates_missing_sqlite_dirs` (leave the
R7 test and its `PROBE` untouched). `BACKEND_DIR` already exists at line 12;
the PROBE_URL keeps the structure.md-pinned sys.path-injecting form, with
`BACKEND_DIR` interpolated at module level, because the child `python -c` runs
from CWDs (notably `tmp_path`) where `db.py` is not otherwise importable:

```python
PROBE_URL = (
    f"import sys; sys.path.insert(0, r'{BACKEND_DIR}'); "
    "import db; print(db.DATABASE_URL)"
)


def test_default_db_path_is_cwd_independent(tmp_path):
    expected = f"sqlite:///{(BACKEND_DIR / 'data' / 'finance.db')}"
    seen = set()
    for cwd in (BACKEND_DIR, tmp_path):
        result = subprocess.run(
            [sys.executable, "-c", PROBE_URL],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60,
            env={k: v for k, v in os.environ.items() if k != "DATABASE_URL"},
        )
        assert result.returncode == 0, result.stderr
        seen.add(result.stdout.strip())
    assert len(seen) == 1
    assert seen.pop() == expected
```

Key details: `DATABASE_URL` is stripped from the child env (db.py loads no
dotenv, so the process env is authoritative) — inheriting it would test the
override, not the default. The assertion compares the full 4-slash URL, so a
regression back to `./data` cannot pass.

### Verification

#### Automated items

- [x] Run: `cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest tests/test_db_engine.py -v`
      Expected: exactly `2 passed` (R7 `test_import_creates_missing_sqlite_dirs`
      + new `test_default_db_path_is_cwd_independent`), 0 failed.

#### Live Verification items

Each command is literal; expected stdout shown after `# ->`.

- [x] Probe from an unrelated CWD:
      ```bash
      cd /tmp/opencode && /home/hermes/finance-tracker/backend/.venv/bin/python -c "import sys; sys.path.insert(0,'/home/hermes/finance-tracker/backend'); import db; print(db.DATABASE_URL)"
      ```
      Expected: `# -> sqlite:////home/hermes/finance-tracker/backend/data/finance.db` (exactly this line, nothing else)
- [x] Probe from repo root:
      ```bash
      cd /home/hermes/finance-tracker && backend/.venv/bin/python -c "import sys; sys.path.insert(0,'/home/hermes/finance-tracker/backend'); import db; print(db.DATABASE_URL)"
      ```
      Expected: identical line — `# -> sqlite:////home/hermes/finance-tracker/backend/data/finance.db`
- [x] Probe from backend/ (bare import, no sys.path injection needed):
      ```bash
      cd /home/hermes/finance-tracker/backend && .venv/bin/python -c "import db; print(db.DATABASE_URL)"
      ```
      Expected: identical line — `# -> sqlite:////home/hermes/finance-tracker/backend/data/finance.db`
- [x] Override semantics byte-for-byte unchanged (D2 — set value wins verbatim, no normalisation):
      ```bash
      cd /tmp/opencode && DATABASE_URL='sqlite:///./weird.db' /home/hermes/finance-tracker/backend/.venv/bin/python -c "import sys; sys.path.insert(0,'/home/hermes/finance-tracker/backend'); import db; print(db.DATABASE_URL)"
      ```
      Expected: `# -> sqlite:///./weird.db` (relative override kept CWD-relative, as documented)
- [x] Memory form still bypasses the mkdir guard (imports cleanly, value untouched):
      ```bash
      cd /tmp/opencode && DATABASE_URL='sqlite://' /home/hermes/finance-tracker/backend/.venv/bin/python -c "import sys; sys.path.insert(0,'/home/hermes/finance-tracker/backend'); import db; print(db.DATABASE_URL)"
      ```
      Expected: `# -> sqlite://` (exit 0; no crash from the guard block)

#### Manual human spot-check

- [ ] `git diff backend/db.py` — eyeball that ONLY the import line and lines 5→
      constant pair changed and the R7 guard block (old lines 7–14) is
      byte-identical, comments intact.

---

## Phase 2 — Documentation truth-pass

**Commit when green:** `docs: name backend/data/finance.db as the single CWD-independent DB location (FIN-E9)`

Scope is exactly six locations (design D5). Historical records
(`docs/superpowers/plans/**`, `thoughts/**`) stay untouched. Parallel-task
dirty files (categorizer/ai.py, main.py, test_categorizer.py, frontend/*) stay
untouched.

### Changes

#### `README.md:19` — architecture tree entry

Before:
```
  data/finance.db  SQLite database (auto-created on startup)
```
After:
```
  data/finance.db  SQLite database (auto-created on startup; path pinned to backend/, CWD-independent)
```

#### `README.md:22` — Database paragraph

Before:
```
**Database:** SQLite file at `backend/data/finance.db`. Tables are auto-created on startup via `Base.metadata.create_all()` -- no migration tool is used. Override the path with the `DATABASE_URL` env var.
```
After:
```
**Database:** SQLite file at `backend/data/finance.db`, resolved absolutely from the backend package directory regardless of the launch directory. Tables are auto-created on startup via `Base.metadata.create_all()` -- no migration tool is used. Override the path with the `DATABASE_URL` env var.
```

#### `SETUP.md:66` — env var table Default column

Before:
```
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |
```
After:
```
| `DATABASE_URL` | No | `sqlite:////<abs>/backend/data/finance.db` — absolute, resolved from the backend package dir | SQLAlchemy database URL. |
```

#### `SETUP.md:151` — Database Management intro

Before:
```
The database is a single SQLite file at `backend/data/finance.db`. No migration tool is used — tables are auto-created on startup.
```
After:
```
The database is a single SQLite file at `backend/data/finance.db`, regardless of the directory you start uvicorn from. No migration tool is used — tables are auto-created on startup.
```

#### `SETUP.md:158` — NO CHANGE (verbatim)

`rm backend/data/finance.db` is already correct. Do not edit.

#### `SETUP.md:165–167` — Direct SQLite Access snippet (drop hidden `cd backend`)

Before:
```bash
cd backend
sqlite3 data/finance.db
```
After:
```bash
sqlite3 backend/data/finance.db
```
(The doc targets humans with the sqlite3 CLI installed; this host lacks it —
do not run this snippet here.)

#### `contracts/schema.json:6`

Before:
```json
    "url_env": "DATABASE_URL (default sqlite:///./data/finance.db)",
```
After:
```json
    "url_env": "DATABASE_URL (default: <repo>/backend/data/finance.db, resolved absolute from the backend package dir)",
```

#### `AGENTS.md:24` — repository layout tree entry

Before:
```
  data/finance.db      SQLite database (auto-created, gitignored)
```
After:
```
  data/finance.db      SQLite database (auto-created, gitignored; path pinned to backend/, CWD-independent)
```

#### `AGENTS.md:70` — env var table Default column

Before:
```
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |
```
After:
```
| `DATABASE_URL` | No | `sqlite:////<abs>/backend/data/finance.db` — absolute, resolved from the backend package dir | SQLAlchemy database URL. |
```

### Verification

#### Automated items

- [x] No stale relative default anywhere in docs or backend source
      (`-I` skips binary `.pyc` matches — e.g. the orphaned
      `backend/alembic/__pycache__/env.cpython-311.pyc` keeps the old string
      forever because nothing imports it; reviewer-pinned flag):
      ```bash
      cd /home/hermes/finance-tracker && grep -rInF 'sqlite:///./data' README.md SETUP.md AGENTS.md contracts/schema.json backend/
      ```
      Expected: **no output, exit code 1** (grep found nothing).
- [x] No doc snippet depends on being inside backend/ for sqlite access:
      ```bash
      cd /home/hermes/finance-tracker && grep -rnF 'sqlite3 data/finance.db' README.md SETUP.md AGENTS.md contracts/schema.json
      ```
      Expected: **no output, exit code 1**.
- [x] Every corrected file names the one true location:
      ```bash
      cd /home/hermes/finance-tracker && grep -rc 'backend/data/finance.db' README.md SETUP.md contracts/schema.json AGENTS.md
      ```
      Expected exactly:
      ```
      # -> README.md:1
      # -> SETUP.md:4
      # -> contracts/schema.json:1
      # -> AGENTS.md:1
      ```

#### Live Verification items

- [x] Docs agree with the running code — print the real default next to the doc rows:
      ```bash
      cd /home/hermes/finance-tracker/backend && .venv/bin/python -c "import db; print(db.DATABASE_URL)" && grep -n 'DATABASE_URL' ../SETUP.md ../AGENTS.md ../contracts/schema.json
      ```
      Expected: first line `# -> sqlite:////home/hermes/finance-tracker/backend/data/finance.db`,
      followed by the SETUP.md:66 / AGENTS.md:70 / schema.json:6 lines, each
      visibly naming `backend/data/finance.db` and containing **no**
      `./data/` fragment.

#### Manual human spot-check

- [ ] Read SETUP.md §Database Management top-to-bottom: no step implies you must
      launch uvicorn (or yourself) from any particular directory.

---

## Phase 3 — Archival + cleanup evidence + live dual-CWD smoke

**Commit when green:** `chore(data): archive stale root data/finance.db out-of-tree with evidence (FIN-E9)`
(commits cleanup.md; the archive itself lives outside the repo by design).

### Changes

#### One-off filesystem operation (run exactly once, via literal script)

Save as `/tmp/opencode/archive-root-db.py` and run with
`cd /home/hermes/finance-tracker && backend/.venv/bin/python /tmp/opencode/archive-root-db.py`:

```python
import hashlib
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path("/home/hermes/finance-tracker")
ROOT_DB = REPO / "data" / "finance.db"
ARCHIVE_DIR = Path("/home/hermes/finance-db-archive")

# Pre-move guard: abort if ANY process holds the root file open.
holders = subprocess.run(["lsof", str(ROOT_DB)], capture_output=True, text=True)
if holders.stdout.strip():
    sys.exit(f"ABORT: {ROOT_DB} still held open:\n{holders.stdout}")
print("PRE_MOVE_LSOF_CLEAR")

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
dest = ARCHIVE_DIR / f"root-data-finance-{stamp}.db"
shutil.move(str(ROOT_DB), str(dest))          # atomic rename, no copy window
os.rmdir(REPO / "data")                       # emptied dir must not linger
print("MOVED_TO", dest)
print("RMDIR_OK", REPO / "data")

sha = hashlib.sha256(dest.read_bytes()).hexdigest()
print("SHA256", sha)

con = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for t in ("budgets", "categories", "rules", "settings",
          "standing_adjustments", "transaction_splits", "transactions"):
    print(t, con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
if "alembic_version" in names:
    print("alembic_version", con.execute("SELECT COUNT(*) FROM alembic_version").fetchone()[0])
else:
    print("alembic_version ABSENT")
con.close()
print("ARCHIVE_DONE")
```

Never delete the archived file. Never compress it. Re-runs cannot clobber
(UTC-timestamped name).

#### File `thoughts/qrspi/t_346c0c73/cleanup.md` (NEW)

Create with this skeleton and fill `<STAMP>` / `<SHA256>` from script output:

```markdown
# FIN-E9 cleanup evidence — root data/finance.db archived

Date: <UTC timestamp of archival>
Executed per thoughts/qrspi/t_346c0c73/plan.md Phase 3.

## Pre-move safety
- Script guard `lsof` on /home/hermes/finance-tracker/data/finance.db returned
  no holders -> PRE_MOVE_LSOF_CLEAR.

## Archive
- Destination: /home/hermes/finance-db-archive/root-data-finance-<STAMP>.db
- sha256: <SHA256>
- Method: shutil.move (atomic rename); root data/ dir removed (os.rmdir).
- The archive is persistent and must never be deleted.

## Row counts of the ARCHIVED copy (venv python sqlite3 module, mode=ro)
| table                | count |
|----------------------|-------|
| budgets              | 32    |
| categories           | 21    |
| rules                | 0     |
| settings             | 1     |
| standing_adjustments | 2     |
| transaction_splits   | 0     |
| transactions         | 4     |
| alembic_version      | 0 (table exists, empty) |

All domain counts match the task.md ground-truth root column.

## Provenance deviation vs task.md
task.md recorded root `alembic_version` as ABSENT. On 2026-08-23, during
plan-phase validation, a root-CWD uvicorn probe ran app startup (create_all +
migrations) against the stale copy, creating an EMPTY alembic_version table
(0 rows). Domain row counts were unaffected. Recorded here so the delta is
explained, not mysterious.
```

### Verification

Order matters: archive FIRST, then smoke (post-fix, even a root-CWD launch can
only touch `backend/data/finance.db`, so ordering cannot resurrect the fork).

#### Automated items

- [x] Full suite green:
      ```bash
      cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest
      ```
      Expected: `195 passed` (today's measured baseline 194 + the new
      CWD-independence test), 0 failed, 0 errors. Warnings line tolerated.

#### Live Verification items

- [x] Pre-move holder check passes (also asserted inside the script):
      ```bash
      lsof /home/hermes/finance-tracker/data/finance.db
      ```
      Expected (immediately before archival): **no output, exit code 1**.
      If it prints anything, STOP — investigate the holder before proceeding.
- [x] Archival script output matches ground truth exactly:
      ```
      PRE_MOVE_LSOF_CLEAR
      MOVED_TO /home/hermes/finance-db-archive/root-data-finance-<STAMP>.db
      RMDIR_OK /home/hermes/finance-tracker/data
      SHA256 <64 hex chars>
      budgets 32
      categories 21
      rules 0
      settings 1
      standing_adjustments 2
      transaction_splits 0
      transactions 4
      alembic_version 0        <- post-probe reality; see Ground-truth correction above
      ARCHIVE_DONE
      ```
- [x] Root data dir is gone:
      ```bash
      ls /home/hermes/finance-tracker/data
      ```
      Expected: `ls: cannot access '/home/hermes/finance-tracker/data': No such file or directory`
- [x] **Dual-CWD uvicorn smoke, root variant (port 8099).** Save as
      `/tmp/opencode/smoke-root-8099.sh` and run `bash /tmp/opencode/smoke-root-8099.sh`.
      (PYTHONPATH is REQUIRED from repo root — without it uvicorn exits with
      `Could not import module "main"`; `$!` is authoritative because fleet
      harness shells pollute `pgrep -f` hits, observed live.)
      ```bash
      #!/usr/bin/env bash
      set -euo pipefail
      cd /home/hermes/finance-tracker
      PYTHONPATH=/home/hermes/finance-tracker/backend \
        backend/.venv/bin/python -m uvicorn main:app --port 8099 >/tmp/opencode/uvicorn-root.log 2>&1 &
      SERVER_PID=$!
      sleep 3
      pgrep -f 'uvicorn main:app --port 8099' | grep -qx "$SERVER_PID"   # pinned pgrep: our pid among hits
      lsof -p "$SERVER_PID" | grep finance.db
      kill "$SERVER_PID"
      wait "$SERVER_PID" 2>/dev/null || true
      echo ROOT_SMOKE_OK
      ```
      Expected: exactly ONE `finance.db` line before `ROOT_SMOKE_OK`, shaped like
      ```
      # -> python  <pid> hermes   3u      REG  8,1 <size> <inode> /home/hermes/finance-tracker/backend/data/finance.db
      # -> ROOT_SMOKE_OK
      ```
      Any line naming `/home/hermes/finance-tracker/data/finance.db` (no
      `backend/`) = FAIL, the fork is back.
- [x] **Dual-CWD uvicorn smoke, backend variant (port 8098).** Save as
      `/tmp/opencode/smoke-backend-8098.sh` and run
      `bash /tmp/opencode/smoke-backend-8098.sh`:
      ```bash
      #!/usr/bin/env bash
      set -euo pipefail
      cd /home/hermes/finance-tracker/backend
      .venv/bin/python -m uvicorn main:app --port 8098 >/tmp/opencode/uvicorn-backend.log 2>&1 &
      SERVER_PID=$!
      sleep 3
      pgrep -f 'uvicorn main:app --port 8098' | grep -qx "$SERVER_PID"
      lsof -p "$SERVER_PID" | grep finance.db
      kill "$SERVER_PID"
      wait "$SERVER_PID" 2>/dev/null || true
      echo BACKEND_SMOKE_OK
      ```
      Expected: exactly ONE line, same shape, naming
      `/home/hermes/finance-tracker/backend/data/finance.db`, then `BACKEND_SMOKE_OK`.
- [x] Live writer untouched throughout:
      ```bash
      ps -p 462314 -o pid=,cmd= && ss -ltn | grep ':8020'
      ```
      Expected: one `ps` line showing PID 462314 running
      `... -m uvicorn main:app --host 127.0.0.1 --port 8020 ...` and one `ss`
      line LISTENing on `127.0.0.1:8020`.

#### Manual human spot-check

- [ ] Skim `thoughts/qrspi/t_346c0c73/cleanup.md`: no `<STAMP>`/`<SHA256>`
      placeholders remain, the seven row counts are filled in and visually match
      the task.md table, and the alembic_version provenance note is present.

---

## Testing checkpoints (final states)

| After | True statements |
|-------|-----------------|
| Phase 1 | `db.DATABASE_URL` is `sqlite:////…/backend/data/finance.db` from any CWD; `DATABASE_URL` override byte-for-byte unchanged; memory forms still bypass the guard; `tests/test_db_engine.py` green (2 passed). |
| Phase 2 | Zero stale `sqlite:///./data` / `sqlite3 data/finance.db` references remain in README.md, SETUP.md, contracts/schema.json, AGENTS.md, backend/; every doc names `<repo>/backend/data/finance.db`. |
| Phase 3 | Root `data/` gone; archive at `/home/hermes/finance-db-archive/root-data-finance-<ts>.db` (never deleted) with sha256 + row counts in cleanup.md; uvicorn from repo root AND backend/ opens ONLY `backend/data/finance.db` (ports 8099/8098 smokes); live PID 462314 undisturbed; full suite 195 passed. |
