# DESIGN — Household Finance re-platform (design-gate artifact)

Task: T8-recon (`t_6595d7cc`). This document is the contract-of-record the parallel
implementation branches build against and the merge gate verifies. It was written
AFTER a full read of the code; every claim cites a path.

## 0. Verdict first

**This is NOT a rewrite.** The repo is a working, well-tested, coherently-structured
application. "Re-platform" here means: **complete the budgeting-truth work** that
`thoughts/task.md` defines and harden the platform seams around it — without
changing what already works. The three tasks described in `thoughts/task.md`
(splits, refunds-as-contra-expense, manual/standing adjustments) are **already
implemented** on `main` (see §2 evidence). What remains is the *next layer*:
consistency, correctness gaps the tasks left open, and structural debt that now
blocks safe parallel work.

Baseline honesty: backend pytest 125/125 PASS, frontend vitest 25/25 PASS,
`tsc -b` clean (2026-08-23, commit 18c3530). Note: tests require
`backend/data/` to exist (gitignored) or TestClient-importing modules fail at
collection with `unable to open database file` — see Risk R7.

## 1. What stays (verified working, do not touch semantics)

| Surface | Evidence | Why it stays |
|---|---|---|
| FastAPI + SQLAlchemy 2 + SQLite stack | `backend/pyproject.toml`, `backend/db.py` | Working, tested, right-sized for a household app |
| Importer abstraction | `backend/importers/base.py` (`BaseImporter.parse`, `make_hash`, `deduplicate_hashes`) + ing/revolut/degiro | Clean extension point, dedup by SHA-256 works |
| Two-tier categoriser (rules → AI fallback) | `backend/categorizer/rules.py`, `ai.py` (batch, sign-grouped, graceful degradation without API key) | Works; AI optional |
| Financial-month engine | `backend/financial_month.py` (`get_financial_month_range`, start_day 1–28) | Correct, tested (`test_financial_month.py`) |
| Effective-parts aggregation core | `backend/aggregate.py` (`effective_parts`, `is_spend_part`) | The single truth for splits+refunds in totals |
| Standing-adjustment materialisation | `backend/adjustments.py` (idempotent, future-month guard, opt-out-by-delete) | Correct semantics, tested |
| Minimal ALTER TABLE migrations | `db.py::run_migrations` | Pragmatic answer to no-migration-tool; keep pattern |
| Frontend stack: React 19 + TS + Vite + TanStack Query + react-router v7 + recharts | `frontend/package.json` | Working, modern, no reason to swap |
| Dark design system via CSS custom props | `frontend/src/index.css` | Coherent token set; inline-style convention documented in AGENTS.md |
| API client centralisation | `frontend/src/api.ts` (all calls through `/api` prefix, Vite proxy → :8000) | Single seam, exactly what contracts need |

## 2. What already changed (the task.md work items are DONE on main)

Recon finding that changes the whole plan: `thoughts/task.md` describes Tasks 2–4
as future work, but `main` already implements them:

- **Splits** — `TransactionSplit` table (`backend/models.py:61-70`),
  `_apply_splits` with sum/sign validation (`backend/routers/transactions.py:73-96`),
  UI in `frontend/src/components/SplitModal.tsx` + `SplitEditor.tsx`,
  aggregates read parts (`aggregate.py`, used by dashboard+budget routers),
  tests `test_splits.py`.
- **Refunds as contra-expense** — `is_refund` flag (`models.py:48`),
  refund validation (`transactions.py:63-71`), netting in all aggregates
  (`aggregate.py:is_spend_part`), three-way choice UI
  (`frontend/src/components/ReviewCard.tsx` PositiveKind income/refund/transfer),
  tests `test_refunds.py`.
- **Manual transactions + standing adjustments** — `manual` source member
  (`models.py:17`), `POST /transactions` auto-confirmed (`transactions.py:141-163`),
  `POST /transactions/adjustment-pair` net-zero enforcement (`transactions.py:166-197`),
  `StandingAdjustment` model + materialisation + router
  (`models.py:72-87`, `adjustments.py`, `routers/standing_adjustments.py`),
  UI in `AddTransactionModal.tsx` + `StandingAdjustments.tsx`,
  tests `test_manual_transactions.py`, `test_standing_adjustments.py`.

So the real scope below is what these implementations left open.

## 3. What changes (the actual re-platform scope)

### IN SCOPE

**S1. Category-type migration integrity (P0, correctness).**
Category type can be edited freely after the fact
(`PATCH /categories/{id}` accepts any type, `backend/routers/categories.py:97-116`;
also patchable from Budget page `TypeCell`). Nothing re-validates dependents when
a category flips type: budgets of an income-typed category silently stop being
read by actuals (`routers/budget.py` skips income/exclude cats), standing
adjustments can end up pointing at non-income/non-expense categories, rules
become sign-incompatible and silently stop matching. Design decision:
type-change becomes a guarded operation — server rejects a change that would
orphan dependents unless `force=true`; response includes a dependency census
(the same counts `delete_category` already computes at `categories.py:120-133`).

**S2. Split/refund interaction gap (P1, correctness).**
`effective_parts` propagates the parent's `is_refund` onto every split part
(`aggregate.py:16-24`), so a split cannot contain one refunded part and one
normal part ("€250 groceries, €125 partner's share returned next month" — the
exact combined case task.md §Relationship describes — cannot be recorded).
Design: move refundness onto the split row (`TransactionSplit.is_refund`, nullable,
parent's flag wins when NULL); `effective_parts` reads per-part flag. Backward
compatible: existing rows get NULL → current behaviour preserved.

**S3. Money as integers (P1, correctness-at-the-seam).**
Amounts are `Numeric(12,2)` in Python (Decimal) but become JSON floats across the
API and `number` in `frontend/src/types.ts`. Sum-then-compare validations like
`splits must sum to amount` compare floats in the browser (`SplitEditor`) before
the Decimal check server-side. Design: standardise the wire format on integer
cents (`amount_cents`) OR explicitly document-and-centralise Decimal↔float
conversion in one serializer module. Decision made: **integer cents on the wire**;
DB stays Numeric(12,2) (no data migration needed — conversion lives only in
Pydantic serializers and one TS helper).

**S4. Aggregation query consolidation (P1, structure).**
The same financial-month + confirmed + effective-parts loop is hand-rolled in
`routers/dashboard.py` (summary + trend), `routers/budget.py`, and partially in
`routers/transactions.py`. Each is a place splits/refund logic can drift.
Design: extract one `spend_by_category(db, year, month)` / `income_by_category(...)`
service module (next to `aggregate.py`) that all three routers call; the
per-router loops disappear.

**S5. Frontend page decomposition + consistency pass (P2, maintainability).**
`pages/Budget.tsx` is 674 lines, `Transactions.tsx` 471, `CategorySelect.tsx`
433 — monolithic single-file pages with inline styles repeated per component
(tooltip style duplicated in Dashboard.tsx and Analytics.tsx, etc.). No new
features; decompose into components under the existing conventions (inline styles,
CSS vars, no CSS framework — per AGENTS.md), deduplicate shared style constants
into one module. Also: error handling is absent on every fetch call in `api.ts`
(non-OK responses surface as undefined data); add a single `apiFetch` wrapper
with typed error propagation.

**S6. Contract tests (P0, merge-gate enabler).**
The merge gate needs consumer-driven seam verification. Add
`backend/tests/test_contract_seams.py`: for every endpoint in
`contracts/api-contracts.json`, assert route existence + response-schema shape
against the contract file itself (contract file loaded as fixture, so gate
failures name the exact violated endpoint). Frontend mirror: a test asserting
every `api.ts` call maps to a declared endpoint.

### OUT OF SCOPE (explicit)

- **No framework/stack swap** (no FastAPI→anything, React→anything).
- **No multi-user/auth** — single household tool.
- **No Postgres/migration-tool adoption** — SQLite + `run_migrations` pattern stays.
- **No person/attribution dimension** on transactions (task.md Task 4 explicitly
  defers this).
- **No cross-month refund linking** (task.md marks it v2).
- **No rule-produced splits** (task.md marks it out of scope for v1).
- **No mobile/responsive overhaul**, no component library adoption.
- **AI prompt upgrade for refund suggestions** (`categorizer/ai.py` proposing
  "refund of X") — deferred; refunds remain a human classification.

## 4. Target architecture (unchanged skeleton, tightened internals)

```
backend/
  main.py               unchanged (router registration, create_all + run_migrations, seed)
  db.py                 unchanged (engine/session/run_migrations/get_db)
  models.py             + TransactionSplit.is_refund (nullable)          [S2]
  schemas.py            + cents-based wire serializers                  [S3]
  aggregate.py          effective_parts reads per-part is_refund        [S2]
  money.py              NEW: Decimal<->cents conversion helpers         [S3]
  spend_service.py      NEW: shared aggregation queries                 [S4]
  routers/*             call spend_service; categories PATCH guarded    [S1,S4]
  tests/test_contract_seams.py  NEW                                     [S6]
frontend/
  src/types.ts          amounts as cents (integer)                      [S3]
  src/api.ts            apiFetch wrapper w/ typed errors                [S5]
  src/money.ts          NEW: cents formatting/parsing                   [S3]
  src/styles/shared.ts  NEW: deduplicated style constants               [S5]
  src/pages/*           decomposed into components/, no behaviour change [S5]
contracts/              manifest.json, api-contracts.json, schema.json  [this gate]
design/                 DESIGN.md, TASK-DAG.md                          [this gate]
```

## 5. Risks

| # | Risk | Mitigation designed in |
|---|---|---|
| R1 | Parallel branches both touch `routers/transactions.py` (it is on nearly every workstream's path) — merge conflicts | DAG sequences S1–S4 into ONE backend branch each owning disjoint files; transactions-router work consolidated in B2 only. Owned-surface manifest forbids cross-editing |
| R2 | Cents migration (S3) breaks every page if done incrementally per-page | S3 lands as ONE atomic branch: `money.ts` + `types.ts` + `api.ts` + all pages in a single PR; gate runs full vitest suite |
| R3 | `run_migrations` ADD COLUMN pattern can't express the S2 column addition safely on live DBs | It can — nullable BOOLEAN DEFAULT NULL is additive; extend the same `new_columns` dict (`db.py:26-40`); covered by contract test asserting column exists |
| R4 | Type-guard change (S1) breaks Daniel's existing data (categories he already re-typed) | Guard applies to NEW changes only; no backfill/reclassification of existing rows |
| R5 | Float sums in frontend split validation diverge from Decimal server validation | S3 removes browser-side float arithmetic entirely (validation on ints) |
| R6 | Frontend decomposition (S5) regresses visuals with no visual-regression harness | Decomposition is move-only refactors reviewed against screenshots; no styling changes ride along |
| R7 | Fresh clone: pytest collection fails (`unable to open database file`) because `backend/data/` is gitignored but `db.py` builds its engine at import time | Documented here; B1 may fix by lazy engine creation ONLY if it touches nothing else (isolated micro-task in DAG) |

## 6. Baseline verification record

- Backend: `.venv/bin/python -m pytest -q` → **125 passed** (after creating gitignored `backend/data/`)
- Frontend: `npx vitest run` → **25 passed (5 files)**; `npx tsc -b` → exit 0
- Commit at verification: `18c3530 feat: add category create/rename/reorder/delete management`
