# FIN-E9 design — pin SQLite path to repo-relative location (kill dual data dirs)

Kanban t_346c0c73 · parent t_f31403bd · qrspi phase 3 (design)

## Current State

- backend/db.py:5 — `DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")`.
  The default is CWD-relative: uvicorn launched from `backend/` writes `backend/data/`,
  launched from repo root writes `./data/`. This forked the database.
- backend/db.py:10-14 — R7 mkdir guard: strips `sqlite:///`, skips bare `sqlite://` and
  `:memory:`, `os.makedirs(dirname)` for everything else. Already correct for ABSOLUTE URLs
  (the leading `/` survives the strip, per backend/tests/test_db_engine.py:21-35).
- Two divergent files exist (task.md ground truth): root `data/finance.db` (61,440 B,
  subset) vs `backend/data/finance.db` (69,632 B, superset, held open by uvicorn PID 462314).
  Canonical = backend/data/finance.db. Both matched by .gitignore:1 (`data/`).
- Neither dir currently has `-wal`/`-shm` siblings (verified by ls).
- Docs still describe the CWD-dependent default: SETUP.md:66, README.md:22 (and tree entry
  README.md:19), contracts/schema.json:6, plus AGENTS.md:24/:70. SETUP.md:151/:158/:166
  already say `backend/data/...` but imply you may run from anywhere.
- backend/main.py:6,27-28 imports `engine` at module import time; seed.py and all routers get
  sessions from `db.SessionLocal`. Nothing else constructs an engine.
- backend/tests/test_db_engine.py — existing R7 guard is subprocess-based because db.py reads
  the env var at import time (module-level constant, see Patterns).

## Desired End State

1. `db.py` default URL resolves to `sqlite:////home/hermes/finance-tracker/backend/data/finance.db`
   (absolute, derived from `Path(__file__).resolve()`) regardless of process CWD.
2. `DATABASE_URL` env var, when set, is used verbatim — byte-for-byte unchanged semantics.
3. Pure-memory forms (`:memory:`, bare `sqlite://`) still bypass the mkdir guard unchanged.
4. Root stale duplicate lives OUTSIDE the repo tree under a timestamped name; row-count
   evidence recorded under thoughts/qrspi/t_346c0c73/.
5. Docs name one truth: the DB is always `<repo>/backend/data/finance.db`.
6. Regression test proves identical resolution from ≥2 different CWDs.

Verification steps (all must pass):
```
cd backend && pytest tests/test_db_engine.py -v          # new + R7 test green
cd /tmp/opencode && <venv python> -c "import sys; sys.path.insert(0,'<repo>/backend'); import db; print(db.DATABASE_URL)"
cd <repo>/backend && <venv python> -c "import db; print(db.DATABASE_URL)"   # identical output
uvicorn smoke from BOTH cwds -> lsof shows one file touched: backend/data/finance.db
ls <repo>/data                                            # gone (archived)
python3 -c "import sqlite3; ..."                          # row counts from ARCHIVED copy match task.md table
pytest (full suite) green
```

## Patterns to Follow

- Subprocess-based env-sensitive tests: backend/tests/test_db_engine.py:14-35 (PROBE string,
  `cwd=BACKEND_DIR`, explicit `env=` dict, timeout=60). New test mirrors this shape.
- Graceful module-level config with narrow special-casing: db.py:5-14 (one constant, one
  guard block, comments explain WHY).
- Doc style of SETUP.md:61-68 (env-var markdown table) for describing defaults.
- Absolute-path tolerance already proven by test_db_engine.py:28 (`f"sqlite:///{target}"`,
  target absolute under tmp_path).

## Patterns to NOT Follow

- Do NOT make DATABASE_URL lazy/dynamic (function or property) to "fix" import-time reads —
  db.py:5 is a module constant consumed at import by main.py:6 and every router; changing
  that contract would ripple everywhere for zero benefit (db.py:5, main.py:6).
- Do NOT add dotenv loading into db.py to pick up `.env` overrides — main.py:1-2 owns
  dotenv; db.py must stay import-order independent.
- Do NOT rewrite the URL or normalise user-supplied env values (no Path() round-trip of the
  override, no slash munging).
- Do NOT touch historical records: docs/superpowers/plans/**, thoughts/** (per engine-prompts/
  01-structure.md:31); do NOT refactor run_migrations or the guard block (db.py:22-52).

## Design Decisions

### D1 — Construction of the CWD-independent default URL
Chosen: derive an absolute filesystem path from the backend package directory, then embed it
in a four-slash SQLAlchemy URL:
```python
from pathlib import Path
_DEFAULT_DB_FILE = (Path(__file__).resolve().parent / "data" / "finance.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB_FILE.as_posix()}")
```
Why this exact form:
- `Path(__file__)` is db.py itself → parent is `<repo>/backend`; `.resolve()` pins symlinks.
- Resulting URL string: `sqlite:///` + `/home/hermes/finance-tracker/backend/data/finance.db`
  = **`sqlite:////home/hermes/finance-tracker/backend/data/finance.db`** (4 leading slashes =
  SQLAlchemy's canonical absolute-sqlite form; verified pattern in test_db_engine.py:28).
- `.as_posix()` guarantees forward slashes so the mkdir guard's `startswith("sqlite:///")`
  strip yields a clean absolute POSIX path.
- Guard compatibility (db.py:10-14): strip leaves `/home/.../backend/data/finance.db`;
  `dirname` is non-empty → `makedirs(exist_ok=True)` still creates `backend/data/` on fresh
  clones. Bare `sqlite://` fails the prefix check; `sqlite:///:memory:` yields `db_file ==
  ":memory:"` → skipped by the second condition (db.py:13). No guard edits needed.
Rejected alternatives: relative-from-repo URL (still CWD-dependent); `os.path.abspath("./data")`
(same bug, just resolved at import); lazy getter (breaks import-time consumers, see D2).

### D2 — Env-var override semantics: byte-for-byte unchanged
Chosen: keep `os.getenv("DATABASE_URL", <new default>)` as the entire override mechanism.
If the variable is set (even to garbage, even relative like the old default), it wins with
zero normalisation. Only the fallback literal changes. Why: the override is documented API
surface (SETUP.md:66, README.md:22, AGENTS.md:70, contracts/schema.json:6); tests inject
URLs through it (test_db_engine.py:28, conftest patterns) and any transformation would be a
behaviour change beyond ticket scope. Relative overrides keep their today-behaviour
(CWD-relative) — documented, not fixed here.

### D3 — Memory forms keep flowing through the existing guard untouched
Chosen: no changes to db.py:7-14. Verified by trace above (D1): `sqlite://` (no file part),
`sqlite:///:memory:` both skip `makedirs` exactly as before; test_db_engine.py's R7 test
continues to exercise the file case. Why: the guard is already absolute-path-safe; touching
it invites regressions in the exact code path R7 was written to protect.

### D4 — Stale root data/finance.db archival procedure
Chosen (executed once during phase 7, NOT at design/implement-of-code time):
- Destination: `/home/hermes/finance-db-archive/` (outside the repo tree, sibling of the
  repo, persistent — deliberately NOT `/tmp`, which is ephemeral and cleaned on reboot).
- Name: `root-data-finance-<YYYYMMDDTHHMMSSZ>.db` (UTC timestamp ⇒ re-runs can never
  clobber; the `root-data-` prefix records its provenance forever).
- Method: `shutil.move()` (atomic rename on same filesystem, no copy window), created with
  `os.makedirs(exist_ok=True)`. NEVER deleted afterwards.
- Pre-move assertion: `lsof` shows no process holding the ROOT file open (ground truth says
  only PID 462314 → backend file). Post-move verification: open the ARCHIVED copy read-only
  with python3 `sqlite3`, dump per-table row counts, append them plus the sha256 to
  `thoughts/qrspi/t_346c0c73/cleanup.md` (the required task-comment evidence).
- Then remove the now-empty root `data/` directory (it holds only finance.db today, is fully
  gitignored, and leaving it invites someone to drop a DB there again). Record the rmdir in
  cleanup.md too.
Why not leave the root file in place gitignored: the whole point of FIN-E9 is one data dir;
a stale 4-transaction DB sitting next to the real one recreates this incident class.

### D5 — Documentation update scope
Exactly these locations (matches ticket + structure-phase list):
- README.md:19 — tree entry `data/finance.db` → `data/finance.db  SQLite database
  (auto-created on startup; path pinned to backend/, CWD-independent)`. README.md:22 — state
  the file lives at `backend/data/finance.db` resolved absolutely regardless of launch dir;
  env override unchanged.
- SETUP.md:66 — default column becomes `` `sqlite:////<abs>/backend/data/finance.db` —
  absolute, resolved from the backend package dir ``. :151 — add "regardless of the
  directory you start uvicorn from". :158 — already `rm backend/data/finance.db`, keep.
  :166 — `sqlite3 data/finance.db` → `sqlite3 backend/data/finance.db` so the snippet works
  from repo root too (adjust preceding `cd` note accordingly).
- contracts/schema.json:6 — `"url_env": "DATABASE_URL (default: <repo>/backend/data/finance.db,
  resolved absolute from the backend package dir)"`.
- AGENTS.md:24 and :70 — same corrections (not in the ticket list but carry the identical
  stale default; flagged by phase 4, included here so docs don't disagree with each other).
- Explicitly excluded: docs/superpowers/plans/**, thoughts/** (historical records).

### D6 — CWD-independence regression test
Chosen: extend backend/tests/test_db_engine.py (keep R7 test untouched), subprocess-based
like the existing guard because db.py reads env at import time (test_db_engine.py:1-6):
```python
def test_default_db_path_is_cwd_independent(tmp_path):
    expected = f"sqlite:///{(BACKEND_DIR / 'data' / 'finance.db')}"
    seen = set()
    for cwd in (BACKEND_DIR, tmp_path):          # backend/ vs somewhere unrelated
        result = subprocess.run(
            [sys.executable, "-c", PROBE_URL],   # "import db; print(db.DATABASE_URL)"
            cwd=cwd, capture_output=True, text=True, timeout=60,
            env={k: v for k, v in os.environ.items() if k != "DATABASE_URL"},
        )
        assert result.returncode == 0, result.stderr
        seen.add(result.stdout.strip())
    assert len(seen) == 1 and seen.pop() == expected
```
Key details: (a) DATABASE_URL is STRIPPED from the child env — inheriting it would test the
override, not the default; db.py loads no dotenv so the process env is authoritative.
(b) CWDs chosen: `BACKEND_DIR` (today's good case) and `tmp_path` (the previously-fatal
case). (c) Assertion compares full URL strings including the 4-slash absolute form, so a
future regression back to `./data` cannot pass. Side effect of the probe: importing db
creates `<repo>/backend/data/` — already true of every dev machine and harmless.

## What We Are NOT Doing

- No migration tool, no Alembic (project convention, db.py:22 docstring).
- No merging of the two databases' contents — ground truth establishes backend/data as the
  superset; root rows (4 txns, 32 budgets) are preserved only inside the archive.
- No change to how uvicorn/dev.sh are invoked; both launch styles become equivalent.
- No lazy DATABASE_URL, no settings object, no pydantic-settings introduction.
- No edits to run_migrations, seed, routers, models, frontend.
- No deletion of the archived file, ever; no compression (keep it plainly openable).
- No touching parallel-task dirty files (categorizer/ai.py, main.py, test_categorizer.py,
  frontend/*) noted in engine-prompts/01-structure.md:64.

## Open Risks

- If another process had the root DB open at archive time, move could fail mid-flight —
  mitigated by the pre-move `lsof` assertion (D4); failure mode is a clean exception.
- Anyone with scripts/habits relying on `cd repo-root && uvicorn` writing to `./data/` gets
  a behaviour change (writes now land in backend/data/) — that is the fix, not a risk, but
  it surfaces as "my old transactions vanished"; cleanup.md documents where they went.
- A developer setting a RELATIVE DATABASE_URL still gets CWD-relative behaviour (unchanged
  semantics, D2); potential future footgun, accepted out of scope.
- CI runners: test D6 assumes writable `$PWD`-adjacent paths only via tmp_path; BACKEND_DIR
  probe writes nothing new unless `backend/data/` is absent (then it creates it — same as
  R7 today).
- `Path.resolve()` on a future relocated clone yields that clone's absolute path — intended;
  but anyone diffing URLs across machines sees different strings (cosmetic).

## Self-answered questions (headless — decided and proceeding)

1. Q: Absolute 4-slash URL vs keeping some relative form? A: Absolute (D1) — the only form
   with no CWD dependence; precedent test_db_engine.py:28.
2. Q: Cache the resolved default at import or recompute? A: Import-time constant (D1/D2) —
   matches current contract; main.py imports once per process.
3. Q: Where to archive? A: `/home/hermes/finance-db-archive/`, timestamped, persistent,
   never deleted (D4); `/tmp` rejected as ephemeral; in-repo path rejected as it must leave
   the tree.
4. Q: Delete the original root file or copy+delete? A: `shutil.move` (single atomic op, no
   dual-copy window), preceded by lsof guard and followed by read-back row counts (D4).
   "Do NOT delete silently" is satisfied by the archive + cleanup.md evidence.
5. Q: Remove the emptied root `data/` dir? A: Yes (D4) — empty, gitignored, and its mere
   existence invited the original fork.
6. Q: Scope of doc edits — ticket list only, or also AGENTS.md? A: Include AGENTS.md:24/:70
   (D5); shipping contradictory docs defeats the ticket's purpose; structure phase agreed.
7. Q: Should SETUP.md:151/:158 change at all since they already say backend/data? A: :151
   gains the "any launch directory" clarification; :158 stays verbatim (already correct);
   :166 loses its hidden `cd backend` dependency (D5).
8. Q: Does the new test also need to cover the override path? A: No — override is already
   exercised by R7 (test_db_engine.py:28); D6 asserts only the default, stripped-env.
9. Q: When does the archival physically happen? A: Phase 7 (implement), as a discrete
   verified step with its own evidence file — not bundled invisibly into the code commit.
