---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 5-plan
---

# Implementation Plan

## Overview

Four routes — Overview / Transactions / Budget / Settings — rebuilt on a Tailwind + token
foundation ("Ledger": hairlines, tabular figures, near-absent colour), plus two backend
capabilities: opt-in per-category rollover derived by walking financial months, and DEGIRO
portfolio-value snapshots in their own table.

## Commands used throughout

| What | Command |
|---|---|
| Backend tests | `cd backend && .venv/bin/pytest` |
| Backend single file | `cd backend && .venv/bin/pytest tests/test_x.py -q` |
| Frontend tests | `cd frontend && npx vitest run` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend typecheck+build | `cd frontend && npm run build` |
| Both dev servers | `./dev.sh` (backend :8000, frontend :5173) |
| Backend alone | `cd backend && .venv/bin/uvicorn main:app --port 8000` |

Backend routers carry **no `/api` prefix** — curl `localhost:8000/budget?month=…` directly. The
Vite proxy rewrites `/api` → `:8000` for the browser only.

## Deviations from `structure.md` (and why)

1. **Tailwind v4, not `tailwind.config.ts` + `postcss.config.js`.** `npm view tailwindcss version`
   → 4.3.3. v4 is CSS-first: `@tailwindcss/vite` plugin + `@theme` in `index.css`. Neither config
   file exists in v4. Phase 2 files change accordingly.
2. **shadcn primitives are hand-written in shadcn style (cva + `cn`), not scaffolded by the CLI.**
   The CLI needs network + rewrites configs + assumes an `@/` alias. Exception: `Modal` wraps
   `@radix-ui/react-dialog`, which supplies `role="dialog"`, focus trap, Escape and focus restore
   as maintained code rather than hand-rolled.
3. **`response_model` on money endpoints needs a `Money` type alias.** Verified in this venv:
   pydantic v2 serialises a `Decimal` field to a **JSON string** (`"12.34"`), while the current
   bare-dict handlers emit a **number** (`12.34`) via `jsonable_encoder`. Wiring `BudgetRow` as-is
   would break `Budget.tsx` arithmetic. Every money field uses
   `Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]`
   (verified: emits `12.34`).
4. **Old-route redirects move from Phase 3 to the phase that absorbs the page.** Structure put
   `/analytics`, `/import`, `/rules` redirects in Phase 3, but Overview does not exist until Phase 4,
   Import is not a panel until Phase 5, and rules are not in Transactions until Phase 6. Redirecting
   in Phase 3 leaves the app *missing* import for two phases. Phase 3 drops them from Nav and puts
   entry-point links on Transactions; each redirect lands in Phase 4 / 5 / 6 respectively.
5. **Phase 2 must also patch `AddTransactionModal` and `SplitModal`.** They read `res.detail`, which
   an `api.ts` that throws will never return. Structure lists them only in Phase 5. Phase 2 adds a
   minimal `try/catch (ApiError)` so nothing regresses in between.
6. **`main.py` gains one `logging.basicConfig` line in Phase 1.** Not in the structure's file list,
   but without it uvicorn's root logger sits at WARNING and the "check the log reports token counts"
   verification cannot pass.
7. **Phase 9 DEGIRO import shape confirmed with the user**: `POST /portfolio/import` takes
   `Portfolio.csv` + a `snapshot_date` form field; value = sum of the `Value in EUR` column.

---

## Phase 0: Safety nets

Two test-only prerequisites. Not a vertical slice — noted explicitly.

### Changes

#### 1. Mock every Anthropic call
**File**: `backend/tests/conftest.py`
**Action**: modify (append)

```python
from unittest.mock import MagicMock
import anthropic

@pytest.fixture(autouse=True)
def anthropic_client(monkeypatch):
    """No test may reach the network. `ai.py` constructs `anthropic.Anthropic()` per
    call, so patching the class is enough. An empty JSON array means the AI
    categorises nothing and rows stay unconfirmed — the pre-existing test
    assertions only count imported/skipped rows, so they are unaffected."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    response = MagicMock()
    response.content = [MagicMock(text="[]")]
    response.stop_reason = "end_turn"
    response.usage = MagicMock(
        input_tokens=0, output_tokens=0,
        cache_creation_input_tokens=0, cache_read_input_tokens=0,
    )
    client = MagicMock()
    client.messages.create.return_value = response
    monkeypatch.setattr(anthropic, "Anthropic", MagicMock(return_value=client))
    return client
```

#### 2. Schema parity test
**File**: `backend/tests/test_migrations.py`
**Action**: create

```python
"""`run_migrations` builds a schema from hand-written DDL fragments (db.py:20-28).
This pins that a DB built by those fragments matches a DB built from the models.

Defaults are deliberately NOT compared: SQLite cannot ADD COLUMN NOT NULL without a
default, so a migrated column legitimately carries one where the model does not.
Type, nullability, primary-key flag and FK actions are what must agree."""
import re
import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects import sqlite
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateTable
from db import Base, run_migrations
import models  # noqa: F401

# Mirrors the keys of run_migrations' `new_columns` dict.
MANAGED = {
    "transactions": ["is_refund", "standing_adjustment_id"],
    "standing_adjustments": ["start_month"],
}


def _create_ddl(table: str) -> str:
    return str(CreateTable(Base.metadata.tables[table]).compile(dialect=sqlite.dialect()))


def _ddl_without(table: str, columns: list[str]) -> str:
    """CREATE TABLE for `table` with `columns` removed.

    SQLAlchemy emits one column and one constraint per line, so dropping every line
    that names the column removes its definition and any FOREIGN KEY clause on it."""
    kept = [
        line for line in _create_ddl(table).splitlines()
        if not any(re.search(rf"\b{c}\b", line) for c in columns)
    ]
    return re.sub(r",(\s*\))", r"\1", "\n".join(kept))  # trailing comma before ")"


def _snapshot(engine) -> dict:
    out = {}
    with engine.begin() as conn:
        for table in sorted(Base.metadata.tables):
            cols = {
                row[1]: (row[2].upper(), row[3], row[5])  # type, notnull, pk
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")
            }
            fks = sorted(
                tuple(row[2:7])  # table, from, to, on_update, on_delete
                for row in conn.exec_driver_sql(f"PRAGMA foreign_key_list({table})")
            )
            out[table] = {"columns": cols, "foreign_keys": fks}
    return out


def _engine():
    return create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


@pytest.fixture
def fresh_engine():
    engine = _engine()
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def migrated_engine():
    """A pre-migration DB: every table, minus the migration-managed columns."""
    engine = _engine()
    with engine.begin() as conn:
        for table in Base.metadata.tables:
            conn.exec_driver_sql(
                _ddl_without(table, MANAGED[table]) if table in MANAGED else _create_ddl(table)
            )
    run_migrations(engine)
    return engine


def test_migration_fragments_target_real_columns():
    for table, columns in MANAGED.items():
        model_columns = set(Base.metadata.tables[table].columns.keys())
        for column in columns:
            assert column in model_columns, f"{table}.{column} has a DDL fragment but no model column"


def test_migrated_schema_matches_models(fresh_engine, migrated_engine):
    assert _snapshot(migrated_engine) == _snapshot(fresh_engine)


def test_backfill_replaces_the_sentinel_start_month(migrated_engine):
    with migrated_engine.begin() as conn:
        rows = list(conn.exec_driver_sql(
            "SELECT start_month FROM standing_adjustments WHERE start_month = '1970-01-01'"
        ))
    assert rows == []
```

#### 3. Fix the two drifts the test exposes
**File**: `backend/db.py`
**Action**: modify (lines 20-32)

```python
    new_columns = {
        "transactions": [
            ("is_refund", "BOOLEAN NOT NULL DEFAULT 0"),
            # models.py:50 declares ON DELETE SET NULL; the fragment must too.
            ("standing_adjustment_id",
             "INTEGER REFERENCES standing_adjustments(id) ON DELETE SET NULL"),
        ],
        "standing_adjustments": [
            # models.py:84 declares NOT NULL. SQLite cannot ADD COLUMN NOT NULL
            # without a default, so a sentinel is added and backfilled below.
            ("start_month", "DATE NOT NULL DEFAULT '1970-01-01'"),
        ],
    }
    backfills = [
        "UPDATE standing_adjustments SET start_month = date('now', 'start of month') "
        "WHERE start_month IS NULL OR start_month = '1970-01-01'",
    ]
```

> **Known limit, out of scope:** `backend/data/finance.db` already ran the old fragment, so its
> `standing_adjustment_id` keeps `NO ACTION` and its `start_month` stays nullable — `ALTER TABLE`
> skips columns that already exist and SQLite cannot alter them in place. The fix corrects every
> DB migrated from here on. A table rebuild is not part of this project. Note that `ondelete` is
> inert anyway: no `PRAGMA foreign_keys=ON` is set (`db.py:7`).

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest` — 125 existing tests + 4 new pass
- [ ] `cd backend && .venv/bin/pytest tests/test_migrations.py -q`

#### Live Verification (agent executes this itself and reports back)
- [ ] Confirm the parity test fails **before** the `db.py` fix:
  `cd backend && git stash push db.py && .venv/bin/pytest tests/test_migrations.py::test_migrated_schema_matches_models -q; git stash pop`
  — expected: **FAILED**, with a diff showing `on_delete` `'NO ACTION'` vs `'SET NULL'` on
  `transactions.standing_adjustment_id` and `notnull` `0` vs `1` on
  `standing_adjustments.start_month`. Then re-run without the stash — expected: **1 passed**.
- [ ] Confirm no test reaches the network:
  `cd backend && env -u ANTHROPIC_API_KEY .venv/bin/pytest tests/test_imports.py -q`
  — expected: `3 passed`, and the run completes in under 2 seconds (previously it made two live
  Haiku calls).

#### Manual (human spot-check)
- [ ] Re-run `cd backend && .venv/bin/pytest -q` yourself and confirm the total is 129 passed.

---

## Phase 1: Bounded AI prompt + logging

### Changes

#### 1. History builders
**File**: `backend/categorizer/history.py`
**Action**: create

```python
"""Bounded prompt context for AI categorisation.

Prompt size is f(categories x TOP_DESCRIPTIONS + batch size), never f(database age):
the guide emits at most TOP_DESCRIPTIONS lines per category, and the neighbour block
at most one line per distinct description present in the batch. Both hard-truncate
against MAX_PROMPT_CHARS.

Neither block includes occurrence counts — that keeps the built prompt byte-identical
as history grows, which is what test_ai_prompt.py pins.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session
from models import Category, Transaction

MAX_PROMPT_CHARS = 12_000
GUIDE_CHAR_SHARE = 0.6  # guide gets 60% of the ceiling, neighbours the rest
TOP_DESCRIPTIONS = 3
MAX_DESCRIPTION_CHARS = 60


def _cat_type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_DESCRIPTION_CHARS else text[:MAX_DESCRIPTION_CHARS - 1] + "…"


def _truncate(lines: list[str], max_chars: int) -> str:
    """Join lines, dropping whole lines once the budget is exhausted."""
    out, used = [], 0
    for line in lines:
        if used + len(line) + 1 > max_chars:
            break
        out.append(line)
        used += len(line) + 1
    return "\n".join(out)


def _normalised(column):
    return func.lower(func.trim(column))


def build_guide_block(db: Session, categories: list[Category], max_chars: int | None = None) -> str:
    """Per category: name, type, and its most frequent confirmed descriptions.

    Stable across a batch, so this is the block that carries the cache breakpoint."""
    max_chars = max_chars or int(MAX_PROMPT_CHARS * GUIDE_CHAR_SHARE)
    ids = [c.id for c in categories]
    if not ids:
        return ""
    rows = (
        db.query(Transaction.category_id, Transaction.description, func.count().label("n"))
        .filter(Transaction.confirmed == True, Transaction.category_id.in_(ids))  # noqa: E712
        .group_by(Transaction.category_id, Transaction.description)
        .order_by(Transaction.category_id, func.count().desc(), Transaction.description)
        .all()
    )
    by_cat: dict[int, list[str]] = {}
    for cid, description, _ in rows:
        seen = by_cat.setdefault(cid, [])
        if len(seen) < TOP_DESCRIPTIONS:
            seen.append(_clip(description))

    lines = []
    for category in categories:
        examples = by_cat.get(category.id, [])
        suffix = " — e.g. " + "; ".join(f'"{d}"' for d in examples) if examples else ""
        lines.append(f"- {category.name} ({_cat_type(category)}){suffix}")
    return _truncate(lines, max_chars)


def build_neighbour_block(db: Session, descriptions: list[str], max_chars: int) -> str:
    """Confirmed history for the descriptions present in THIS batch only.

    Matching is exact on lower(trim(description)) so the whole lookup is one query
    with an IN list bounded by the batch size — it never scans the table into Python."""
    wanted = sorted({" ".join(d.split()).lower() for d in descriptions if d.strip()})
    if not wanted:
        return ""
    key = _normalised(Transaction.description)
    rows = (
        db.query(key.label("d"), Category.name, func.count().label("n"))
        .join(Category, Transaction.category_id == Category.id)
        .filter(Transaction.confirmed == True, key.in_(wanted))  # noqa: E712
        .group_by("d", Category.id)
        .order_by("d", func.count().desc(), Category.name)
        .all()
    )
    majority: dict[str, str] = {}
    for description, category_name, _ in rows:
        majority.setdefault(description, category_name)  # first = highest count

    lines = [f'- "{_clip(d)}" → {majority[d]}' for d in wanted if d in majority]
    return _truncate(lines, max_chars)
```

#### 2. Prompt assembly, caching and logging
**File**: `backend/categorizer/ai.py`
**Action**: modify

- Add `import logging, time` and `logger = logging.getLogger(__name__)`; replace **all 5** `print()`
  calls with `logger.error(...)` (`logger.warning` for the non-list JSON case).
- Import `build_guide_block`, `build_neighbour_block`, `MAX_PROMPT_CHARS`, `GUIDE_CHAR_SHARE`.
- Build the guide **once per `batch_categorise_with_ai` call**, before the sign loop:

```python
SYSTEM_INSTRUCTIONS = (
    "You are a financial transaction categoriser for a Dutch household budget. "
    "Use the category guide and the history of previously confirmed descriptions as "
    "evidence. Respond with JSON only."
)

    guide_block = build_guide_block(db, all_categories)
```

- Per batch, after `tx_lines` is built:

```python
            neighbour_budget = MAX_PROMPT_CHARS - int(MAX_PROMPT_CHARS * GUIDE_CHAR_SHARE)
            neighbours = build_neighbour_block(
                db, [tx.description for _, tx in batch], neighbour_budget
            )
            prompt = (
                f"Categorise each {group_label} transaction below into one of the "
                f"available categories.\n"
                f"Available categories: {', '.join(category_names)}\n\n"
                "Transactions:\n" + "\n".join(tx_lines) + "\n\n"
                "Respond with a JSON array only. Each element: "
                '{"index": <number>, "category": "<name>", "confidence": <0.0-1.0>}'
            )
            if neighbours:
                prompt = (
                    "Previously confirmed categorisations for descriptions in this batch:\n"
                    + neighbours + "\n\n" + prompt
                )
```

- The system prompt becomes a content-block list with the breakpoint on the guide (stable prefix
  first, volatile content after — the prefix-match rule):

```python
                system = [{"type": "text", "text": SYSTEM_INSTRUCTIONS}]
                if guide_block:
                    system.append({
                        "type": "text",
                        "text": "Category guide:\n" + guide_block,
                        "cache_control": {"type": "ephemeral"},
                    })
                started = time.monotonic()
                response = client.messages.create(
                    model=AI_MODEL, max_tokens=4096, system=system,
                    messages=[{"role": "user", "content": prompt}],
                )
```

> **Caching caveat, worth stating rather than assuming:** the minimum cacheable prefix on
> `claude-haiku-4-5` is **4096 tokens**. A 21-category guide is roughly 600 tokens, so the
> breakpoint will silently create no cache entry (no error — `cache_creation_input_tokens` is just
> 0). It is placed correctly for when the guide grows, and the log line below makes whether it is
> working observable instead of assumed.

- Log every call, including the fields nothing currently reads:

```python
                usage = response.usage
                logger.info(
                    "ai_categorise group=%s batch=%d rows=%d prompt_chars=%d "
                    "in_tok=%s out_tok=%s cache_write=%s cache_read=%s stop=%s latency_ms=%d",
                    group_label, batch_start // BATCH_SIZE, len(batch),
                    len(prompt) + sum(len(b["text"]) for b in system),
                    usage.input_tokens, usage.output_tokens,
                    getattr(usage, "cache_creation_input_tokens", None),
                    getattr(usage, "cache_read_input_tokens", None),
                    response.stop_reason, int((time.monotonic() - started) * 1000),
                )
                if response.stop_reason == "max_tokens":
                    logger.warning(
                        "ai_categorise truncated at max_tokens; dropping %d rows", len(batch)
                    )
```

#### 3. Import outcome logging
**File**: `backend/routers/imports.py`
**Action**: modify — add `logger = logging.getLogger(__name__)` and, before the `return` in
`confirm`:

```python
    logger.info(
        "import source=%s imported=%d skipped=%d by_rule=%d by_ai=%d uncategorised=%d",
        source, imported, skipped, by_rule, by_ai, uncategorised,
    )
```

#### 4. Make INFO logs actually appear
**File**: `backend/main.py`
**Action**: modify — after `load_dotenv()`:

```python
import logging, os
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
```

#### 5. Prompt-size tests
**File**: `backend/tests/test_ai_prompt.py`
**Action**: create

```python
"""Prompt size must be a function of category count and batch size, never of how
much history the database has accumulated."""
from datetime import date
from decimal import Decimal
import pytest
from sqlalchemy import insert
from categorizer.history import (
    MAX_PROMPT_CHARS, build_guide_block, build_neighbour_block,
)
from models import Category, Transaction
from seed import run_seed

DESCRIPTIONS = [f"MERCHANT {i:03d}" for i in range(500)]


def _fill(db, rows: int):
    categories = db.query(Category).all()
    ids = [c.id for c in categories if c.type.value in ("needs", "wants", "savings")]
    db.execute(insert(Transaction), [
        {
            "date": date(2026, 4, 1), "amount": Decimal("-10.00"),
            "description": DESCRIPTIONS[i % len(DESCRIPTIONS)], "source": "ing",
            "import_hash": f"h{rows}-{i}", "confirmed": True,
            "category_id": ids[i % len(ids)], "is_refund": False,
        }
        for i in range(rows)
    ])
    db.commit()
    return categories


def _built(db, categories):
    batch = DESCRIPTIONS[:50]
    guide = build_guide_block(db, categories)
    neighbours = build_neighbour_block(db, batch, MAX_PROMPT_CHARS // 2)
    return guide, neighbours


def test_prompt_stays_under_ceiling_with_50k_rows(db):
    run_seed(db)
    categories = _fill(db, 50_000)
    guide, neighbours = _built(db, categories)
    assert len(guide) + len(neighbours) <= MAX_PROMPT_CHARS


def test_prompt_is_invariant_to_history_size(db):
    run_seed(db)
    small = _built(db, _fill(db, 1_000))
    large = _built(db, _fill(db, 49_000))  # same vocabulary, 50x the rows
    assert small == large


def test_neighbour_block_covers_only_the_batch(db):
    run_seed(db)
    categories = _fill(db, 1_000)
    block = build_neighbour_block(db, ["MERCHANT 007"], MAX_PROMPT_CHARS)
    assert block.count("\n") == 0
    assert "MERCHANT 007" in block
    assert "MERCHANT 008" not in block


def test_guide_emits_one_line_per_category(db):
    run_seed(db)
    categories = _fill(db, 1_000)
    guide = build_guide_block(db, categories)
    assert len(guide.splitlines()) == len(categories)
```

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_ai_prompt.py -q`
- [ ] `cd backend && .venv/bin/pytest` — full suite still green

#### Live Verification
- [ ] Start the backend against a scratch DB and import a real ING CSV, checking the log line:
  ```
  cd backend && rm -f data/plan_check.db && \
    DATABASE_URL=sqlite:///./data/plan_check.db LOG_LEVEL=INFO \
    .venv/bin/uvicorn main:app --port 8001
  ```
  then in another shell (uses the CSV literal already pinned in `tests/test_imports.py`):
  ```
  printf '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"\n"20260301";"Albert Heijn";"NL57INGB0000000000";"";"BA";"Debit";"67,40";"Payment terminal";"";"";"";""\n' > /tmp/ing.csv
  curl -s -F source=ing -F file=@/tmp/ing.csv localhost:8001/import/confirm
  ```
  — expected: JSON `{"imported":1,...}` from curl, and on the uvicorn console **one**
  `ai_categorise group=expense batch=0 rows=1 prompt_chars=… in_tok=… out_tok=… cache_write=…
  cache_read=… stop=end_turn latency_ms=…` line followed by an `import source=ing imported=1 …`
  line. (Needs a real `ANTHROPIC_API_KEY` in `backend/.env`; if the key is absent the log line is
  `[AI categoriser] Configuration error` at ERROR level instead — that also proves logging works.)
- [ ] `grep -c "print(" backend/categorizer/ai.py` — expected: `0`

#### Manual (human spot-check)
- [ ] Read one `ai_categorise` line and confirm `prompt_chars` is under 12000.

---

## Phase 2: Ledger kit + API hardening

### Changes

#### 1. Dependencies
```
cd frontend && npm install tailwindcss @tailwindcss/vite clsx tailwind-merge \
  class-variance-authority @radix-ui/react-dialog
cd frontend && npm install -D eslint-plugin-jsx-a11y
```

#### 2. Vite plugin
**File**: `frontend/vite.config.ts` — add `import tailwindcss from '@tailwindcss/vite'` and
`tailwindcss()` to `plugins`. No `tailwind.config.ts`, no `postcss.config.js` (Tailwind v4).

#### 3. Token layer
**File**: `frontend/src/index.css`
**Action**: replace entirely

```css
@import "tailwindcss";

/* The viewer's theme is stamped on <html data-theme>; dark is the default. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  /* Light ramp. Every text/background pair below clears 4.5:1. */
  --paper:        #fbfbfa;
  --paper-raised: #ffffff;
  --paper-sunken: #f2f1ee;
  --ink:          #16181c;  /* 16.6:1 on paper */
  --ink-muted:    #4e5560;  /*  8.0:1 */
  --ink-subtle:   #6b7280;  /*  4.7:1 — the floor, still AA */
  --rule:         rgba(22, 24, 28, 0.12);
  --rule-strong:  rgba(22, 24, 28, 0.24);
  --over:         #b3261e;  /*  6.3:1 */
  --under:        #1f7a4d;  /*  5.1:1 */
  --accent:       #3f5ce0;  /* fill only — never body text */
  --accent-ink:   #ffffff;  /*  5.5:1 on accent */
}

[data-theme="dark"] {
  --paper:        #0b0d10;
  --paper-raised: #121519;
  --paper-sunken: #07090b;
  --ink:          #e8eaed;  /* 15.1:1 */
  --ink-muted:    #9aa3ad;  /*  7.6:1 */
  --ink-subtle:   #767f8b;  /*  4.7:1 */
  --rule:         rgba(232, 234, 237, 0.10);
  --rule-strong:  rgba(232, 234, 237, 0.20);
  --over:         #f2777a;  /*  7.1:1 */
  --under:        #5fb98a;  /*  8.2:1 */
  --accent:       #3f5ce0;
  --accent-ink:   #ffffff;
}

@theme inline {
  --color-paper:        var(--paper);
  --color-paper-raised: var(--paper-raised);
  --color-paper-sunken: var(--paper-sunken);
  --color-ink:          var(--ink);
  --color-ink-muted:    var(--ink-muted);
  --color-ink-subtle:   var(--ink-subtle);
  --color-rule:         var(--rule);
  --color-rule-strong:  var(--rule-strong);
  --color-over:         var(--over);
  --color-under:        var(--under);
  --color-accent:       var(--accent);
  --color-accent-ink:   var(--accent-ink);

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-num:  ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", monospace;
}

/* Ledger rules, enforced once so no page can reintroduce them:
   no shadow tokens, no gradient tokens. Structure comes from --rule and space. */
html { color-scheme: light dark; }
[data-theme="dark"] { color-scheme: dark; }
body { @apply bg-paper text-ink font-sans antialiased; }
.tabular { font-family: var(--font-num); font-variant-numeric: tabular-nums; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

**File**: `frontend/src/App.css` — **delete** (dead Vite starter template).
**File**: `frontend/index.html` — add `data-theme="dark"` to `<html>`.

#### 4. `cn` helper
**File**: `frontend/src/lib/cn.ts`
**Action**: create

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

#### 5. Primitives
**File**: `frontend/src/components/ui/*.tsx`
**Action**: create — one file each. Contracts:

| Component | Contract |
|---|---|
| `Button` | `cva` variants `primary` (bg-accent / text-accent-ink) \| `ghost` \| `danger`; sizes `sm`\|`md`. Always a real `<button>` with `type`. No gradient, no shadow. |
| `Card` | `<section>` + `border border-rule rounded-lg bg-paper-raised p-5`. Optional `title` renders an `<h2>`. |
| `Table` | `Table`/`THead`/`TR`/`TH`/`TD` exports. `Table` wraps in `<div class="overflow-x-auto">` — the 375px requirement. `TD align="right"` applies `.tabular`. |
| `Input` | forwardRef `<input>`, `border-rule`, focus ring from `:focus-visible`. Never `outline-none`. |
| `Field` | `label` + generated `id` via `useId()`, wires `htmlFor`, renders `error` in `<p role="alert">` and sets `aria-invalid`/`aria-describedby`. |
| `Modal` | Radix `Dialog` — `Root`/`Portal`/`Overlay`/`Content`/`Title`/`Close`. Supplies `role="dialog"`, `aria-modal`, focus trap, Escape and focus restore. `title` is required (Radix warns without `Dialog.Title`). |
| `Badge` | typographic tag for needs/wants/savings: uppercase, `text-[11px] tracking-wide text-ink-subtle border border-rule rounded px-1.5`. **No colour map** — this kills the three duplicates. |
| `EmptyState` | `title` + optional `action`; centred, `text-ink-muted`. |
| `Spinner` | `role="status"` + visually-hidden "Loading". The single loading treatment. |
| `Amount` | `value: number`, `currency = '€'`; `.tabular text-right`, 2 decimals, `tabular-nums`; `signed` prop colours negative `text-over` / positive `text-under`. Decimal alignment lives here. |

#### 6. API client throws
**File**: `frontend/src/api.ts`
**Action**: modify — add at the top and route **all 26 methods** through `request`:

```ts
const BASE = '/api'

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
    } catch { /* non-JSON error body — keep statusText */ }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
```

Example rewrite (apply the same shape to every method):

```ts
  getBudget: (month: string) => request<BudgetRow[]>(`/budget?month=${month}`),
  patchBudget: (id: number, planned_amount: number) =>
    request(`/budget/${id}`, json('PATCH', { planned_amount })),
```

`previewImport`/`confirmImport` keep their `FormData` body — pass `{ method: 'POST', body: fd }`
as `init`. `getNextReview` still resolves `null` when the body is `null`.

#### 7. Call sites that read `res.detail`
The seven sites found by `grep -rn "\.detail" frontend/src` must catch instead:

```ts
  try {
    await api.patchCategory(id, { name })
  } catch (e) {
    setError(e instanceof ApiError ? e.detail : 'Could not rename')
    return
  }
```

- `components/CategoryManager.tsx` (3 sites) and `components/StandingAdjustments.tsx` (1) — converted
  fully as part of this phase's rebuild.
- `components/AddTransactionModal.tsx` (2) and `components/SplitModal.tsx` (2) — **minimal
  try/catch only**; they are rebuilt in Phase 5.

#### 8. Query defaults + error boundary
**File**: `frontend/src/App.tsx`
**Action**: modify

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})
```

**File**: `frontend/src/components/ErrorBoundary.tsx` — create a class component rendering
`<EmptyState title="Something went wrong" …>` with a Reload button; wrap `<Routes>` with it.

#### 9. Settings rebuilt on the kit
**Files**: `frontend/src/pages/Settings.tsx`, `frontend/src/components/CategoryManager.tsx`,
`frontend/src/components/StandingAdjustments.tsx`
**Action**: modify — zero `style={{`, zero hex literals, `Card`/`Field`/`Input`/`Button`/`Table`
only. `Settings.test.tsx` queries by `role="spinbutton"` and the strings `'Financial Month Start
Day'` / `'Save'` — keep the input a `type="number"` and those exact labels so the existing test
stays green unmodified. Drag-reorder grips in `CategoryManager` become `<button>` with
`aria-label` (jsx-a11y requires it).

#### 10. ESLint a11y
**File**: `frontend/eslint.config.js`
**Action**: modify

```js
import jsxA11y from 'eslint-plugin-jsx-a11y'
// …inside extends:
      jsxA11y.flatConfigs.recommended,
```

#### 11. API client test
**File**: `frontend/src/tests/api.test.ts`
**Action**: create

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from '../api'

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })))

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('throws ApiError carrying status and detail on a 4xx', async () => {
    mockFetch(422, { detail: "'Boodschappen' already exists" })
    await expect(api.createCategory({ name: 'Boodschappen', type: 'needs' }))
      .rejects.toMatchObject({ name: 'ApiError', status: 422, detail: "'Boodschappen' already exists" })
  })

  it('throws on a 500 with a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(api.getCategories()).rejects.toBeInstanceOf(ApiError)
  })

  it('resolves the parsed body on 2xx', async () => {
    mockFetch(200, [{ id: 1, name: 'Boodschappen', type: 'needs', sort_order: 0 }])
    await expect(api.getCategories()).resolves.toHaveLength(1)
  })
})
```

**File**: `frontend/src/tests/CategoryManager.test.tsx` — the 3 tests named
"…resolves with `.detail`" must be updated to **reject** with an `ApiError` instead of resolving:
`vi.fn(() => Promise.reject(new ApiError(422, "'X' already exists")))`. Assertions on the rendered
message stay identical.

### Verification
#### Automated
- [ ] `cd frontend && npx vitest run` — existing `Settings.test.tsx` green **unmodified**, new
      `api.test.ts` green, `CategoryManager.test.tsx` green after the reject-contract update
- [ ] `cd frontend && npm run lint` — passes with `jsx-a11y` enforced
- [ ] `cd frontend && npm run build` — `tsc -b` clean

#### Live Verification
- [ ] `grep -c "style={{" frontend/src/pages/Settings.tsx frontend/src/components/CategoryManager.tsx frontend/src/components/StandingAdjustments.tsx`
      — expected: `0` for all three
- [ ] `grep -rn "#[0-9a-fA-F]\{6\}" frontend/src/pages/Settings.tsx frontend/src/components/ui/`
      — expected: no output
- [ ] `test -f frontend/src/App.css && echo STILL-THERE || echo DELETED` — expected: `DELETED`
- [ ] `./dev.sh`, open `http://localhost:5173/settings`, then in the browser console
      `document.documentElement.dataset.theme = 'light'` — expected: the page re-renders in the
      light ramp with no unstyled or invisible text; set it back to `'dark'` and it returns.
- [ ] With devtools responsive mode at **375 x 812**, run in the console
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
      — expected: `true` (no horizontal overflow).

#### Manual (human spot-check)
- [ ] Tab through Settings with the keyboard: every control reachable, focus ring visible on each.

---

## Phase 3: Shell — four routes, month in the URL, unconfirmed banner

### Changes

#### 1. Shared month window (backend)
**File**: `backend/month_window.py`
**Action**: create

```python
"""The financial-month read path, in one place.

Replaces `_get_start_day` copy-pasted into three routers and the byte-identical
three-predicate filter clause duplicated at budget.py:70-74, dashboard.py:33-37 and
dashboard.py:106-110. Read-only by design: it never materialises anything."""
from datetime import date
from sqlalchemy.orm import Session, selectinload
from models import Setting, Transaction
from financial_month import get_financial_month_range

DEFAULT_START_DAY = 24


def get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else DEFAULT_START_DAY


def month_window(year: int, month: int, start_day: int) -> tuple[date, date]:
    return get_financial_month_range(year, month, start_day)


def month_window_query(db: Session, year: int, month: int, start_day: int):
    """Confirmed transactions inside the financial month, splits eager-loaded.
    Callers add their own filters and call .all()."""
    start_date, end_date = month_window(year, month, start_day)
    return (
        db.query(Transaction)
        .options(selectinload(Transaction.splits))
        .filter(
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            Transaction.confirmed == True,  # noqa: E712
        )
    )
```

**Files**: `backend/routers/budget.py`, `dashboard.py`, `transactions.py`
**Action**: modify — delete the three `_get_start_day` definitions, import from `month_window`, and
replace each duplicated query. `dashboard.py`'s trend loop uses `month_window_query(db, y, m,
start_day).all()`. `transactions.py:110-111` uses `month_window(...)` for its range (it must keep
its own query — it does *not* filter `confirmed`). The `materialise_standing_adjustments` calls
stay exactly where they are; the helper adds no side effects.

#### 2. Unconfirmed summary endpoint
**File**: `backend/schemas.py`
**Action**: modify — add the `Money` alias and the new schema

```python
from typing import Annotated
from pydantic import PlainSerializer

# Decimal keeps precision through validation; JSON stays a number, not a string.
# (pydantic v2 serialises a bare Decimal field as "12.34" — that would break the
# frontend's `number` types on every money field.)
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class UnconfirmedSummary(BaseModel):
    count: int
    total: Money
```

**File**: `backend/routers/transactions.py`
**Action**: modify — add next to `/review` (no conflict: there is no `GET /{tx_id}` route)

```python
@router.get("/unconfirmed-summary", response_model=UnconfirmedSummary)
def unconfirmed_summary(month: str = Query(...), db: Session = Depends(get_db)):
    """How much spend is sitting outside every total, for this financial month.

    `total` is the expense contribution those rows WOULD make if confirmed —
    sum of -amount over spend parts, same arithmetic every other total uses."""
    year, mo = _parse_month(month)
    start_day = get_start_day(db)
    start_date, end_date = month_window(year, mo, start_day)
    txs = (
        db.query(Transaction).options(selectinload(Transaction.splits))
        .filter(Transaction.date >= start_date, Transaction.date <= end_date,
                Transaction.confirmed == False)  # noqa: E712
        .all()
    )
    total = sum(
        -amount for tx in txs for _, amount, refund in effective_parts(tx)
        if is_spend_part(amount, refund)
    )
    return UnconfirmedSummary(count=len(txs), total=Decimal(total))
```

Extract the repeated `datetime.strptime(month, "%Y-%m")` + 422 into `_parse_month(month) ->
tuple[int, int]` in `month_window.py` and use it in all four handlers.

#### 3. Month in the URL
**File**: `frontend/src/hooks/useMonth.ts`
**Action**: create

```ts
import { useSearchParams } from 'react-router-dom'

export const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Selected month lives in ?month=YYYY-MM so it survives navigation and is linkable.
 *  Replaces three component-local useState copies and three currentMonth() helpers. */
export function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonth()
  const setMonth = (m: string) => {
    const next = new URLSearchParams(params)
    next.set('month', m)
    setParams(next, { replace: true })
  }
  return [month, setMonth]
}
```

Delete the `currentMonth()` copies at `Dashboard.tsx:23-26`, `Analytics.tsx:21-24`,
`Budget.tsx:241-244` and their `useState`; each page calls `useMonth()`.

#### 4. Unconfirmed banner
**File**: `frontend/src/components/UnconfirmedBanner.tsx`
**Action**: create — `useQuery(['unconfirmed', month], () => api.getUnconfirmedSummary(month))`;
renders `null` when `count === 0`; otherwise a `border-l-2 border-over` strip reading
`N unconfirmed (€X) not counted` with a `<Link to={'/transactions?month=' + month + '&review=1'}>`
labelled "Review". Mounted on Overview, Transactions and Budget.

**File**: `frontend/src/api.ts` — add
`getUnconfirmedSummary: (month: string) => request<UnconfirmedSummary>(\`/transactions/unconfirmed-summary?month=${month}\`)`
and `UnconfirmedSummary { count: number; total: number }` to `types.ts`.

#### 5. Nav and routes
**File**: `frontend/src/components/Nav.tsx`
**Action**: rewrite — four links (Overview `/`, Transactions, Budget, Settings), no inline styles,
no gradient brand mark. Below `sm:` the link row collapses behind a `<button aria-expanded>`
disclosure instead of overflowing. Active link = `aria-current="page"` + `text-ink` +
`border-b-2 border-accent` (accent as a rule, never as text — it does not clear 4.5:1 as text).

**File**: `frontend/src/App.tsx` — routes become `/` (Dashboard for now), `/transactions`,
`/budget`, `/settings`, plus `/import` and `/rules` still mounted (Nav no longer links them;
Transactions gets "Import CSV" and "Manage rules" links until Phases 5 and 6 absorb them), plus
`<Route path="*" element={<Navigate to="/" replace />} />`. `/analytics` stays until Phase 4.

#### 6. Backend test for the extraction
**File**: `backend/tests/test_month_window.py`
**Action**: create — build a month of rows and assert `month_window_query(...).all()` returns
exactly the same ids as the literal three-predicate filter the routers used, for `start_day` 1 and
24, and that calling it creates no rows (`Transaction` count unchanged before/after).

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest` — including the new `test_month_window.py`
- [ ] `cd frontend && npx vitest run` — new test: rendering `<Nav>` + a route at
      `/budget?month=2026-04` and clicking "Overview" keeps `?month=2026-04` in the URL; new test:
      `UnconfirmedBanner` shows the count and links to review, and renders nothing at `count: 0`
- [ ] `cd frontend && npm run lint && npm run build`

#### Live Verification
- [ ] `cd backend && .venv/bin/uvicorn main:app --port 8001` then
      `curl -s "localhost:8001/transactions/unconfirmed-summary?month=2026-04"`
      — expected: `{"count":0,"total":0.0}` on the seeded DB (numeric `total`, **not** `"0.0"` —
      this is the `Money` alias working). Then `curl -s "localhost:8001/transactions/unconfirmed-summary?month=nope"`
      — expected: HTTP 422 with `{"detail":"month must be in YYYY-MM format"}`.
- [ ] `grep -rn "_get_start_day" backend/routers/` — expected: no output.
- [ ] `./dev.sh`, then open `http://localhost:5173/budget?month=2026-04`, click **Overview** in the
      nav — expected: the URL becomes `/?month=2026-04` and the month selector still reads April.

#### Manual (human spot-check)
- [ ] Deep-link `http://localhost:5173/?month=2026-04` in a fresh tab and confirm April loads.

---

## Phase 4: Overview page

### Changes

#### 1. Wire the dashboard response model
**File**: `backend/schemas.py`
**Action**: modify — `DashboardSummary` money fields become `Money`; add typed row models so the
shape is real rather than `list[dict]`:

```python
class CategoryBreakdownRow(BaseModel):
    category_id: int
    category_name: str
    actual: float
    planned: float
    type: str

class IncomeBreakdownRow(BaseModel):
    category_id: int
    category_name: str
    amount: float

class TrendPoint(BaseModel):
    month: str
    total: float

class NeedsWantsSavings(BaseModel):
    needs: float
    wants: float
    savings: float

class DashboardSummary(BaseModel):
    month: str
    total_income: float
    total_expenses: float
    total_savings: float
    left_over: float
    category_breakdown: list[CategoryBreakdownRow]
    income_breakdown: list[IncomeBreakdownRow]
    needs_wants_savings: NeedsWantsSavings
    monthly_trend: list[TrendPoint]
```

`float` (not `Money`) because the handler already emits floats at `dashboard.py:120-134` — this
pins the current wire format exactly rather than changing it.

**File**: `backend/routers/dashboard.py` — `@router.get("/summary", response_model=DashboardSummary)`.
**Do not change the handler arithmetic.**

**File**: `backend/tests/test_dashboard.py` — add a test pinning the known divergence so it cannot
be "fixed" by accident: one confirmed row on a `needs` category and one confirmed row with
`category_id=None`; assert `total_expenses` counts both while `sum(category_breakdown[*].actual)`
counts only the first.

#### 2. Overview page
**File**: `frontend/src/pages/Overview.tsx`
**Action**: create — deletes `pages/Dashboard.tsx` and `pages/Analytics.tsx`.

Structure: month selector → `UnconfirmedBanner` → `SummaryCards` → needs/wants/savings split →
category breakdown → 6-month trend. One `['dashboard', month]` query, `isLoading` → `Spinner`,
`isError` → `EmptyState` with the `ApiError.detail`.

**File**: `frontend/src/components/charts/ChartFrame.tsx`
**Action**: create — the single Recharts wrapper. Ledger rules encoded once:
`<CartesianGrid stroke="var(--rule)" vertical={false} />`, `<XAxis tickLine={false}
axisLine={{ stroke: 'var(--rule)' }} />`, `fill="var(--ink-muted)"` for bars, **no gradient
`<defs>`, no `<Area>` fill**, direct `<LabelList>` instead of a legend where it fits. Replaces the
two duplicate colour maps.

**File**: `frontend/src/components/SummaryCards.tsx` — convert to `Card` + `Amount`; grid becomes
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (was a fixed `repeat(4,1fr)`).

**File**: `frontend/src/App.tsx` — `/` renders `Overview`; add
`<Route path="/analytics" element={<Navigate to="/" replace />} />`.

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_dashboard.py -q`
- [ ] `cd frontend && npx vitest run` — new `Overview.test.tsx`: renders totals from a mocked
      summary, shows `EmptyState` when the query rejects with an `ApiError`
- [ ] `cd frontend && npm run lint && npm run build`

#### Live Verification
- [ ] `curl -s "localhost:8001/dashboard/summary?month=2026-04" | head -c 400`
      — expected: 200 with `"total_income"` as a **number**, and the response still containing
      `category_breakdown`, `income_breakdown`, `needs_wants_savings`, `monthly_trend`
      (a `response_model` drops undeclared keys — this proves none were dropped).
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' "localhost:8001/dashboard/summary?month=2026-04"`
      — expected: `200` (a response_model mismatch surfaces as 500, so this is the real check).
- [ ] `grep -c "style={{" frontend/src/pages/Overview.tsx frontend/src/components/SummaryCards.tsx`
      — expected: `0` for both
- [ ] `ls frontend/src/pages/` — expected: no `Dashboard.tsx`, no `Analytics.tsx`
- [ ] Devtools at 375 x 812 on `/`: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
      — expected: `true`

#### Manual (human spot-check)
- [ ] Look at the charts in both themes and confirm no gradient fills and hairline gridlines.

---

## Phase 5: Transactions page — list, review and import in one place

### Changes

#### 1. Import as a panel on React Query
**File**: `frontend/src/components/ImportPanel.tsx`
**Action**: create — deletes `pages/Import.tsx`.

```tsx
const importMutation = useMutation({
  mutationFn: ({ source, file }: { source: string; file: File }) => api.confirmImport(source, file),
  onSuccess: () => {
    // Import writes more rows than anything else in the app and currently
    // invalidates nothing (Import.tsx:39-62).
    for (const key of [['transactions'], ['review'], ['dashboard'], ['budget'], ['unconfirmed']]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  },
})
```

Three source buttons become a `role="radiogroup"` modelled on `ReviewCard.tsx:184-207`. The file
input gets a real `<label htmlFor>`. Errors render from `ApiError.detail`. Preview table uses
`Table` + `Amount`.

#### 2. Transactions page
**File**: `frontend/src/pages/Transactions.tsx`
**Action**: rewrite — month selector, `UnconfirmedBanner`, filter row, the list, and two panels
toggled by `?import=1` / the review queue by `?review=1` (so the banner's link lands correctly).
`?rules=1` is wired in Phase 6. Zero inline styles; `<style>` block at `:468` removed.

#### 3. Modals and the dropdown
**Files**: `frontend/src/components/{ReviewCard,SplitModal,AddTransactionModal,CategorySelect}.tsx`
**Action**: modify

- `SplitModal` and `AddTransactionModal` render inside the Phase 2 `Modal` — the hand-rolled shells
  at `SplitModal.tsx:68-86` and `AddTransactionModal.tsx:114-133` are deleted, and the Phase 2
  stop-gap try/catch becomes the permanent `ApiError` handling.
- `AddTransactionModal.tsx:149-233` becomes a `role="radiogroup"` like `ReviewCard.tsx:184-207`.
- `CategorySelect` gains `aria-activedescendant` (pointing at the `highlightIdx` option's id, which
  today is visual only), `Home`/`End` keys, and focus restore to the trigger on close. Remove the 8
  `outline: 'none'` sites; keep the existing arrow/Enter/Escape handling.

### Verification
#### Automated
- [ ] `cd frontend && npx vitest run` — new tests:
      (a) a successful import calls `invalidateQueries` for all five keys (spy on the client),
      (b) `CategorySelect` moves the highlight with ArrowDown/Home/End and sets
          `aria-activedescendant` to the highlighted option's id,
      (c) opening `SplitModal` moves focus inside, `Tab` cycles within it, `Escape` closes it and
          focus returns to the trigger button
- [ ] `cd frontend && npm run lint && npm run build`

#### Live Verification
- [ ] `ls frontend/src/pages/` — expected: no `Import.tsx`
- [ ] `grep -rn "outline: 'none'\|outline:'none'" frontend/src` — expected: no output
- [ ] `./dev.sh`, go to `http://localhost:5173/transactions?import=1`, upload `/tmp/ing.csv` from
      Phase 1 — expected: the confirm response renders a summary **and** the transaction list below
      updates without a page reload (proves the invalidation), and the unconfirmed banner count
      changes if the row landed unconfirmed.
- [ ] On `/transactions`, press `Tab` to a category select, `Enter`, `ArrowDown`, `Escape` —
      expected: focus is back on the select trigger, visibly ringed.

#### Manual (human spot-check)
- [ ] Import a real ING CSV and work the review queue to empty; confirm the banner disappears.

---

## Phase 6: Rules inside Transactions, with editable patterns

### Changes

#### 1. One matcher
**File**: `backend/categorizer/rules.py`
**Action**: modify

```python
def match_pattern(pattern: str, description: str) -> bool:
    """The single rule-matching mechanism.

    Replaces three: the Python `in` at rules.py:20, the duplicate at
    transactions.py:251, and the SQL ilike at rules.py:51-53 (where a `%` or `_`
    in a user pattern silently acted as a wildcard). Case-insensitive substring,
    whitespace-normalised on both sides — no regex, no wildcards."""
    needle = " ".join(pattern.split()).lower()
    return bool(needle) and needle in " ".join(description.split()).lower()
```

`apply_rules` calls it; `transactions.py:251` calls it; `rules.py`'s preview calls it.

#### 2. Rule creation takes a body
**File**: `backend/schemas.py` — `class CreateRuleRequest(BaseModel): pattern: str; priority: int = 0`
**File**: `backend/routers/transactions.py`
**Action**: modify `create_rule_from_transaction` — takes `body: CreateRuleRequest`, uses
`body.pattern.strip()` (422 if blank) instead of `tx.description.lower().strip()`, and passes
`body.priority`. The backfill loop uses `match_pattern`, and the inline sign gate at `:257-261` is
replaced by `_is_sign_compatible(t.amount, category)` imported from `categorizer.rules`.

#### 3. Exact preview count
**File**: `backend/routers/rules.py`
**Action**: modify — replace `POST /rules/test` with

```python
@router.get("/preview", response_model=RulePreview)
def preview_rule(pattern: str = Query(...), db: Session = Depends(get_db)):
    """Exact match count plus a handful of samples.

    The old endpoint did `.limit(20)` then `matches[:5]` and reported the capped
    number as if it were the total."""
    rows = db.query(Transaction).order_by(Transaction.date.desc()).all()
    matches = [t for t in rows if match_pattern(pattern, t.description)]
    return RulePreview(
        match_count=len(matches),
        samples=[TransactionOut.model_validate(_to_out(t)) for t in matches[:5]],
    )
```

`class RulePreview(BaseModel): match_count: int; samples: list[TransactionOut]`. A full scan is
consistent with everything else here at 222 rows; note it, do not index.

#### 4. Rule drawer
**File**: `frontend/src/components/RuleDrawer.tsx`
**Action**: create — deletes `pages/Rules.tsx`; mounted on Transactions behind `?rules=1`, and
opened from a review card's "Always categorise like this" action. The pattern is a text `Input`
pre-filled with the description, debounced 300ms into
`useQuery(['rule-preview', pattern], () => api.previewRule(pattern))`, showing
`{match_count} transactions match` live above the Save button. `Rules.tsx:37-40`'s raw inline
`fetch` is deleted — everything goes through `api.ts`.

**File**: `frontend/src/App.tsx` — `/rules` becomes
`<Navigate to="/transactions?rules=1" replace />`.

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_rules.py tests/test_categorizer.py tests/test_transactions.py -q`
      — new tests: `match_pattern` is the only matcher (a `%` in a pattern matches literally, not as
      a wildcard); preview count equals the true total for a pattern matching >20 rows; the sign
      gate behaviour at `test_categorizer.py:156-171` and
      `test_transactions.py::test_create_rule_sign_aware_skips_incompatible` is unchanged
- [ ] `cd frontend && npx vitest run` — editing the pattern updates the match count before saving
- [ ] `cd frontend && npm run lint && npm run build`

#### Live Verification
- [ ] With 25+ rows matching, `curl -s "localhost:8001/rules/preview?pattern=a"`
      — expected: `match_count` equal to the true row count (verify against
      `curl -s localhost:8001/transactions | python3 -c "import json,sys; print(sum('a' in t['description'].lower() for t in json.load(sys.stdin)))"`),
      and exactly 5 entries in `samples`.
- [ ] `curl -s "localhost:8001/rules/preview?pattern=%25"` (a literal `%`) — expected:
      `match_count: 0` on the seeded data, not "everything" (the old `ilike` treated it as a wildcard).
- [ ] `curl -s -X POST localhost:8001/transactions/1/create-rule -H 'Content-Type: application/json' -d '{"pattern":"albert heijn","priority":0}'`
      — expected: 200 with `{"rule_created":"albert heijn","transactions_updated":N}`; posting
      `{"pattern":"   ","priority":0}` — expected: 422.
- [ ] `ls frontend/src/pages/` — expected: no `Rules.tsx`

#### Manual (human spot-check)
- [ ] In the review queue, create a rule from a transaction, shorten the pattern to the merchant
      name, and confirm the live count rises before you save.

---

## Phase 7: Budget page

### Changes

#### 1. Fix the schema to match the handler
**File**: `backend/schemas.py`
**Action**: modify `BudgetRow` — add the key the handler already emits and switch money to `Money`:

```python
class BudgetRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    category_name: str
    category_type: str          # budget.py:95 emits this; the schema was missing it
    month: Optional[date]
    planned_amount: Money
    actual_amount: Optional[Money] = None
```

**File**: `backend/routers/budget.py` — `@router.get("", response_model=list[BudgetRow])`.
Fix the schema, **not** the handler.

#### 2. Budget on the kit
**File**: `frontend/src/pages/Budget.tsx`
**Action**: rewrite

- `TypeCell` (`:21-115`, the second independent dropdown) is **deleted**; the type cell renders the
  Phase 2 `Badge` and, when editable, the shared `CategorySelect`.
- `TYPE_CFG` (`:8-12`, the raw-hex duplicate colour map) is deleted.
- The drill-down `<tr onClick>` at `:320` becomes a `<button aria-expanded={isExpanded}
  aria-controls={detailId}>` in the first cell; the `<span onClick>` at `:370` becomes a real
  `<button>` that swaps in the number `Input`.
- Table wrapped by the `Table` primitive's `overflow-x-auto` container.
- Progress bars: a single `div` filled to `min(actual/planned, 1)` in `bg-over` when over,
  `bg-ink-muted` otherwise. No gradients.
- `invalidateQueries` on save now includes `['dashboard']` (the same page reads it — `:285-288`
  omits it today) and `['unconfirmed']`.

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_budget.py -q` — new test asserting the response
      includes `category_type` and that `planned_amount` deserialises as a JSON number
- [ ] `cd frontend && npx vitest run` — new test: the drill-down row expands via keyboard
      (`Tab` to the button, `Enter`) and `aria-expanded` flips
- [ ] `cd frontend && npm run lint && npm run build`

#### Live Verification
- [ ] `curl -s "localhost:8001/budget?month=2026-04" | python3 -m json.tool | head -20`
      — expected: 200, each row carrying `category_type`, and `planned_amount` rendered as
      `250.0` (number) not `"250.00"` (string). A 500 here means the `response_model` and the
      handler disagree.
- [ ] `grep -c "style={{" frontend/src/pages/Budget.tsx` — expected: `0`
- [ ] `grep -n "TypeCell\|TYPE_CFG" frontend/src/pages/Budget.tsx` — expected: no output
- [ ] Devtools at 375 x 812 on `/budget`:
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth` — expected:
      `true` (the table scrolls inside its own wrapper).

#### Manual (human spot-check)
- [ ] Expand a category with the keyboard only and edit a planned amount without touching the mouse.

---

## Phase 8: Rollover

### Changes

#### 1. Two columns — model and fragment, written to agree
**File**: `backend/models.py`
**Action**: modify `Category`

```python
    # Opt-in per-category carry. Balance is never stored — see rollover.py.
    rollover_enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    rollover_start_month = Column(Date, nullable=True)  # 1st of the first month that carries
```

**File**: `backend/db.py`
**Action**: modify — add to `new_columns`

```python
        "categories": [
            ("rollover_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
            ("rollover_start_month", "DATE"),
        ],
```

**File**: `backend/tests/test_migrations.py` — add `"categories": ["rollover_enabled",
"rollover_start_month"]` to `MANAGED`. The Phase 0 parity test then proves the two edits agree.

#### 2. Derived balance
**File**: `backend/rollover.py`
**Action**: create

```python
"""Rollover balance, derived by walking financial months — never stored.

Stored balances go stale on any retro-edit or late confirmation, and since
`confirmed` gates all money that happens constantly. Walking is self-healing.
The carry is a plain running total: an overspend carries its negative forward,
with no special case."""
from datetime import date
from decimal import Decimal
from sqlalchemy.orm import Session
from aggregate import effective_parts, is_spend_part
from models import Budget, Category
from month_window import month_window_query


def _next_label_month(year: int, month: int) -> tuple[int, int]:
    """Steps the month LABEL. The date window always comes from
    get_financial_month_range — never from calendar arithmetic on dates."""
    return (year + 1, 1) if month == 12 else (year, month + 1)


def category_balance(
    db: Session, category: Category, upto_month: str, start_day: int
) -> Decimal | None:
    """Running planned-minus-actual from rollover_start_month through upto_month
    inclusive. Returns None when rollover is off or has no start month."""
    if not category.rollover_enabled or category.rollover_start_month is None:
        return None

    year, month = int(upto_month[:4]), int(upto_month[5:7])
    y, m = category.rollover_start_month.year, category.rollover_start_month.month
    if (y, m) > (year, month):
        return Decimal("0")

    balance = Decimal("0")
    while (y, m) <= (year, month):
        row = (
            db.query(Budget)
            .filter_by(category_id=category.id, month=date(y, m, 1))
            .first()
        )
        # A month never opened in the Budget page has no rows (_auto_populate runs
        # on GET /budget only). It contributes planned = 0, so its actual spend
        # still counts against the carry. Pinned by test_rollover.py.
        planned = row.planned_amount if row else Decimal("0")

        actual = Decimal("0")
        for tx in month_window_query(db, y, m, start_day).all():
            for cid, amount, refund in effective_parts(tx):
                if cid == category.id and is_spend_part(amount, refund):
                    actual -= amount

        balance += planned - actual
        y, m = _next_label_month(y, m)
    return balance
```

#### 3. Expose it
**File**: `backend/schemas.py` — `BudgetRow` gains `rollover_balance: Optional[Money] = None`;
`CategoryOut` gains `rollover_enabled: bool = False` and `rollover_start_month: Optional[date] = None`.
**File**: `backend/routers/budget.py` — after building each row, set
`"rollover_balance": category_balance(db, cat, month, start_day)`.
**File**: `backend/routers/categories.py` — `CategoryPatch` (defined inline at `:30`) gains
`rollover_enabled: Optional[bool]` and `rollover_start_month: Optional[date]`; the handler sets
them, and when `rollover_enabled` is turned on with no explicit start month it defaults to the
current label month:

```python
    if body.rollover_enabled is not None:
        cat.rollover_enabled = body.rollover_enabled
        if body.rollover_enabled and cat.rollover_start_month is None:
            today = date.today()
            cat.rollover_start_month = date(today.year, today.month, 1)
    if body.rollover_start_month is not None:
        cat.rollover_start_month = body.rollover_start_month
```

`_out(cat)` returns the two new fields.

#### 4. Test the arithmetic by hand
**File**: `backend/tests/test_rollover.py`
**Action**: create — a three-month hand-computed sequence with `start_day=24`:

| Month | planned | actual | month delta | running balance |
|---|---|---|---|---|
| 2026-03 | 200 | 150 | +50 | **50** |
| 2026-04 | 200 | 260 | −60 | **−10** (overspend carries; no special case) |
| 2026-05 | *no budget row* → 0 | 40 | −40 | **−50** (unmaterialised month) |

Tests: the balance at each of the three months matches exactly; `rollover_enabled=False` returns
`None`; a start month later than the requested month returns `Decimal("0")`; unconfirmed rows in
one of the months change nothing.

#### 5. Toggle in the UI
**File**: `frontend/src/pages/Budget.tsx` — a rollover checkbox per row (`Field` + `Input
type="checkbox"`, `PATCH /categories/{id}`), and a "Carried: €X" line under the planned amount when
`rollover_balance !== null`, rendered with `Amount signed`.

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_rollover.py -q`
- [ ] `cd backend && .venv/bin/pytest tests/test_migrations.py -q` — parity still holds with the
      two new columns
- [ ] `cd backend && .venv/bin/pytest` — full suite
- [ ] `cd frontend && npx vitest run && npm run lint && npm run build`

#### Live Verification
- [ ] Prove the fragments migrate an old DB correctly:
  ```
  cd backend && rm -f data/plan_mig.db && \
    DATABASE_URL=sqlite:///./data/plan_mig.db .venv/bin/python -c "
  from sqlalchemy import create_engine
  from db import Base; import models
  e = create_engine('sqlite:///./data/plan_mig.db')
  Base.metadata.create_all(e)
  with e.begin() as c:
      c.exec_driver_sql('ALTER TABLE categories DROP COLUMN rollover_enabled')
      c.exec_driver_sql('ALTER TABLE categories DROP COLUMN rollover_start_month')
  from db import run_migrations; run_migrations(e)
  with e.begin() as c:
      print([r[1] for r in c.exec_driver_sql('PRAGMA table_info(categories)')])
  "
  ```
  — expected: the printed list contains `rollover_enabled` and `rollover_start_month`.
- [ ] `curl -s -X PATCH localhost:8001/categories/1 -H 'Content-Type: application/json' -d '{"rollover_enabled":true}'`
      — expected: 200 with `"rollover_enabled": true` and a non-null `rollover_start_month` set to
      the 1st of the current month.
- [ ] `curl -s "localhost:8001/budget?month=2026-04" | python3 -c "import json,sys; print([(r['category_name'], r['rollover_balance']) for r in json.load(sys.stdin)][:5])"`
      — expected: the toggled category shows a numeric `rollover_balance`, every other shows `None`.
- [ ] Confirm the GET has no write side effect:
      `sqlite3 backend/data/plan_mig.db "select count(*) from transactions"` before and after the
      budget curl — expected: identical.

#### Manual (human spot-check)
- [ ] Toggle rollover on a category in the Budget page and check the carried figure against the
      previous month's planned-minus-actual by hand.

---

## Phase 9: DEGIRO portfolio snapshots

### Changes

#### 1. The table
**File**: `backend/models.py`
**Action**: modify — append

```python
class PortfolioSnapshot(Base):
    """Total portfolio value at a point in time. Deliberately NOT in `transactions`:
    a snapshot is a balance, not a cash movement, so double-counting against the
    ING→DEGIRO savings rows is impossible by construction."""
    __tablename__ = "portfolio_snapshots"
    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    value = Column(Numeric(12, 2), nullable=False)
    import_hash = Column(String, nullable=False, unique=True)
```

No `db.py` fragment needed — `run_migrations` skips absent tables (`db.py:36-37`) and
`create_all` (`main.py:27`) creates whole tables on an existing DB. The Phase 0 parity test covers
it automatically because it iterates `Base.metadata.tables`.

#### 2. Parser
**File**: `backend/importers/degiro_snapshot.py`
**Action**: create

```python
"""DEGIRO Portfolio.csv → one dated total.

The export is a snapshot of current holdings with NO date column, so the date is
supplied by the caller. Value = sum of the "Value in EUR" column. Amounts use
Dutch formatting: 4.641,00 → 4641.00."""
import csv
import io
from datetime import date
from decimal import Decimal
from importers.base import make_hash

VALUE_COLUMN = "Value in EUR"


def _to_decimal(raw: str) -> Decimal:
    return Decimal(raw.strip().replace(".", "").replace(",", "."))


def parse_portfolio(content: str, snapshot_date: date) -> tuple[Decimal, str]:
    reader = csv.DictReader(io.StringIO(content))
    if reader.fieldnames is None or VALUE_COLUMN not in reader.fieldnames:
        raise ValueError(f"Expected a '{VALUE_COLUMN}' column, got {reader.fieldnames}")
    total = sum(
        (_to_decimal(row[VALUE_COLUMN]) for row in reader if (row.get(VALUE_COLUMN) or "").strip()),
        Decimal("0"),
    )
    # Same deterministic-hash pattern as adjustments.py:46, so re-uploading the
    # same export for the same date is a no-op.
    return total, make_hash("degiro-snapshot", snapshot_date, total, "portfolio")
```

#### 3. Endpoints
**File**: `backend/routers/portfolio.py`
**Action**: create

```python
router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.post("/import", response_model=PortfolioImportResult)
async def import_snapshot(
    snapshot_date: date = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)
):
    content = file.file.read().decode("utf-8", errors="replace")
    try:
        value, import_hash = parse_portfolio(content, snapshot_date)
    except (ValueError, InvalidOperation) as e:
        raise HTTPException(status_code=422, detail=f"Could not parse the export: {e}")
    if db.query(PortfolioSnapshot).filter_by(import_hash=import_hash).first():
        return PortfolioImportResult(date=snapshot_date, value=value, created=False)
    db.add(PortfolioSnapshot(date=snapshot_date, value=value, import_hash=import_hash))
    db.commit()
    return PortfolioImportResult(date=snapshot_date, value=value, created=True)


@router.get("/snapshots", response_model=PortfolioSeries)
def snapshots(
    from_: date | None = Query(None, alias="from"),
    to: date | None = Query(None),
    db: Session = Depends(get_db),
):
    """growth = value change over the window − contributions in the window.

    Contributions come from existing ING→DEGIRO savings rows, identified by the
    DEGIRO category; snapshots plot at their real dates and are never interpolated."""
    q = db.query(PortfolioSnapshot).order_by(PortfolioSnapshot.date.asc())
    if from_:
        q = q.filter(PortfolioSnapshot.date >= from_)
    if to:
        q = q.filter(PortfolioSnapshot.date <= to)
    rows = q.all()
    if not rows:
        return PortfolioSeries(points=[], value_change=Decimal("0"),
                               contributions=Decimal("0"), growth=Decimal("0"))

    category = db.query(Category).filter(Category.name == "DEGIRO").first()
    contributions = Decimal("0")
    if category:
        txs = (
            db.query(Transaction).options(selectinload(Transaction.splits))
            .filter(Transaction.date >= rows[0].date, Transaction.date <= rows[-1].date,
                    Transaction.confirmed == True)  # noqa: E712
            .all()
        )
        for tx in txs:
            for cid, amount, refund in effective_parts(tx):
                if cid == category.id and is_spend_part(amount, refund):
                    contributions -= amount

    value_change = rows[-1].value - rows[0].value
    return PortfolioSeries(
        points=[PortfolioPoint(date=r.date, value=r.value) for r in rows],
        value_change=value_change,
        contributions=contributions,
        growth=value_change - contributions,
    )
```

**File**: `backend/schemas.py` — `PortfolioPoint {date, value: Money}`,
`PortfolioSeries {points, value_change: Money, contributions: Money, growth: Money}`,
`PortfolioImportResult {date, value: Money, created: bool}`.
**File**: `backend/main.py` — register the router.

#### 4. Frontend
**File**: `frontend/src/api.ts` — `importPortfolio(date, file)` (FormData) and
`getPortfolio(from?, to?)`.
**File**: `frontend/src/pages/Overview.tsx` — a Portfolio card: a Recharts `LineChart` on
`<XAxis dataKey="date" type="category" />` with `scale="time"` **off** — points sit at their real
dates with `connectNulls={false}` and **no interpolation between missing dates** — plus a
value-change / contributions / growth row using `Amount`. Upload control lives in the same card.

### Verification
#### Automated
- [ ] `cd backend && .venv/bin/pytest tests/test_portfolio.py -q` — new tests:
      (a) importing the same export twice inserts one row and returns `created: false` the second
          time,
      (b) `select count(*) from transactions` is unchanged by any snapshot import — the
          double-counting guard,
      (c) two snapshots 4641.00 → 5200.00 with one confirmed −300.00 DEGIRO row between them give
          `value_change: 559.0`, `contributions: 300.0`, `growth: 259.0`,
      (d) a CSV with no `Value in EUR` column returns 422
- [ ] `cd backend && .venv/bin/pytest` — full suite, migrations parity included
- [ ] `cd frontend && npx vitest run && npm run lint && npm run build`

#### Live Verification
- [ ] Build a sample export and import it twice:
  ```
  printf 'Product,Symbol/ISIN,Amount,Closing,Local value,Value in EUR\nVWRL,IE00B3RBWM25,42,110.50,"4.641,00","4.641,00"\nIWDA,IE00B4L5Y983,10,90.00,"900,00","900,00"\n' > /tmp/portfolio.csv
  curl -s -F snapshot_date=2026-08-01 -F file=@/tmp/portfolio.csv localhost:8001/portfolio/import
  curl -s -F snapshot_date=2026-08-01 -F file=@/tmp/portfolio.csv localhost:8001/portfolio/import
  ```
  — expected: first call `{"date":"2026-08-01","value":5541.0,"created":true}` (4641.00 + 900.00),
  second call the identical body with `"created":false`.
- [ ] `sqlite3 backend/data/plan_mig.db "select count(*) from portfolio_snapshots; select count(*) from transactions;"`
      — expected: `1` snapshot, and the transactions count **identical** to before the imports.
- [ ] `curl -s "localhost:8001/portfolio/snapshots"` — expected: one point at `2026-08-01`,
      `value_change: 0.0`, and `growth == value_change - contributions`.

#### Manual (human spot-check)
- [ ] Upload a real DEGIRO Portfolio export with today's date and confirm the total on the Overview
      card matches what the DEGIRO app shows.

---

## Testing Checkpoints

| After | True |
|---|---|
| 0 | `pytest` passes offline; schema parity asserted; both known drifts fixed. |
| 1 | Prompt size is f(categories, batch) not f(database age), pinned against 50k synthetic rows; every AI call logs tokens, cache fields, stop reason and latency. |
| 2 | Tailwind + tokens + primitives exist; Settings has zero inline styles; a 4xx throws `ApiError`; jsx-a11y passes. |
| 3 | Four routes; `?month=` survives navigation; the unconfirmed gap is visible on every money page; the window query exists once. |
| 4 | Overview replaces Dashboard + Analytics on the kit, with a wired `response_model` and the divergence pinned. |
| 5 | Transactions holds list + review + import; import invalidates its writes; modals trap and restore focus. |
| 6 | One pattern matcher; patterns editable at creation with an exact live count; Rules page gone. |
| 7 | Budget on the kit, keyboard-reachable, one dropdown implementation app-wide. |
| 8 | A rollover balance is reproducible by hand from its month sequence, including overspend and never-opened months. |
| 9 | No portfolio snapshot ever appears in `transactions`; repeat imports are no-ops. |
