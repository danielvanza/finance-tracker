# TASK-DAG — finance-tracker re-platform workstreams

Feeds decompose-and-spawn vs decompose-and-queue. Effort is relative
(1 = smallest sensible branch). Every branch's owned surface is defined in
`contracts/manifest.json` (branch_manifests) — that file, not this one, is what
the merge gate enforces. Contract references point at `contracts/api-contracts.json`
and `contracts/schema.json`.

## The dependency spine

```
G-contract-tests ──────────────────────────┐ (parallel with everything; runs on main today)
                                           │
B1-backend-schema-money ──► B2-backend-routers-service
        │                           │
        └──► F1-frontend-types-money ──► F2-frontend-decompose
```

Critical path: B1 → B2 → (F1) → F2. G runs fully parallel from minute zero.
B1 and G can spawn simultaneously. F1 depends only on B1 (not B2), but must not
MERGE before B2 because the cents wire format flips response units — shipping F1
without B2 would render cent-scaled values against float endpoints.

## Branches

### G-contract-tests (effort 2) — spawn first, parallel with all
- **Owns:** `backend/tests/test_contract_seams.py`, `frontend/src/tests/contract.test.ts`
- **Satisfies:** whole `api-contracts.json` + `manifest.json` (gate presence itself)
- **Work:** for each endpoint in api-contracts.json assert route exists and a real
  request/response round-trips through TestClient matching the declared shape
  (contract file loaded as fixture so failures name the endpoint); frontend mirror
  asserts every `api.ts` call maps to a declared endpoint id.
- **Depends on:** nothing. **Note:** written against CURRENT main behaviour except
  the v2 money-unit fields, which the test marks `xfail(strict)` until B1 lands.
- **Acceptance:** pytest + vitest green with the new files; deleting either file
  or contracts/ fails the suite (suppression guard).

### B1-backend-schema-money (effort 3)
- **Owns:** `backend/models.py`, `backend/schemas.py`, `backend/db.py`, NEW
  `backend/money.py`, `backend/aggregate.py`, backend tests
- **Satisfies:** `schema.json#v2_migration_delta`, `api-contracts.json#money_wire_format_v2`
- **Work:**
  1. `TransactionSplit.is_refund` nullable column + `run_migrations` entry
     (`db.py` new_columns dict) — schema.json v2_migration_delta.
  2. `effective_parts` reads per-part refund flag, parent fallback when NULL
     (closes S2: split-with-one-refunded-part now expressible).
  3. `money.py`: Decimal↔cents helpers; Pydantic serializers emit integer cents
     for every monetary field per api-contracts v2 (field names unchanged).
  4. Optional micro-fix if trivially isolated: lazy engine creation in `db.py`
     so fresh clones don't need gitignored `data/` to run tests (Risk R7).
- **Depends on:** nothing. **Parallel-safe with:** G.
- **Acceptance:** existing router tests updated ONLY where they assert response
  money fields (units change); new test: split with mixed refund part aggregates
  correctly; migrations apply on a pre-v2 SQLite file.

### B2-backend-routers-service (effort 4) — SEQUENCED after B1
- **Owns:** `backend/routers/**`, NEW `backend/spend_service.py`, `backend/adjustments.py`, backend tests
- **Satisfies:** `api-contracts.json#endpoints`, `api-contracts.json#category-patch.v2_change_category_type_guard`
- **Work:**
  1. Extract shared aggregation into `spend_service.py`
     (`spend_by_category`, `income_by_category`, month-range+confirmed query
     builder) and rewire dashboard/budget/transactions routers onto it (kills
     the three hand-rolled loops — S4).
  2. Category-type change guard in `routers/categories.py::patch_category`:
     compute dependency census (reuse delete_category counts), reject with 422 +
     counts unless `force:true` (S1).
  3. Split-part refund support in `routers/transactions.py::_apply_splits` +
     `_to_out` (SplitOut gains is_refund) — completes B1's schema work at the API.
- **Depends on:** B1 merged (needs schemas/money/aggregate). **Must NOT start
  before B1 merges** — same hot file (`transactions.py`) otherwise.
- **Acceptance:** contract-seam tests pass for all endpoints incl. type-guard
  cases; dashboard+budget numbers identical to pre-refactor on seeded fixtures.

### F1-frontend-types-money (effort 4) — parallel build allowed, MERGE after B1+B2
- **Owns:** `frontend/src/types.ts`, `frontend/src/api.ts`, NEW
  `frontend/src/money.ts`, pages/**, components/**, frontend tests
- **Satisfies:** `schema.json#ts_mirror`, `api-contracts.json#money_wire_format_v2`
- **Work:**
  1. Atomic cents flip: types.ts amounts → integer; money.ts formatting/parsing;
     every page/component renders via money.ts; inputs parse via money.ts (S3).
  2. `apiFetch` wrapper in api.ts with typed non-OK error propagation (S5 slice).
  3. TransactionSplit.is_refund surfaced in ReviewCard/SplitEditor UI.
- **Depends on:** B1 (wire format) for correctness of build; B2 for merge order.
- **Acceptance:** vitest green; tsc clean; no raw euro math left outside money.ts
  (grep gate: no `toFixed(` outside money.ts).

### F2-frontend-decompose (effort 3) — after F1
- **Owns:** `frontend/src/pages/**`, `frontend/src/components/**`, NEW `frontend/src/styles/shared.ts`
- **Satisfies:** nothing external (pure internal quality); must keep all
  F1-era tests green unchanged.
- **Work:** move-only decomposition of Budget.tsx (674 lines), Transactions.tsx
  (471), CategorySelect.tsx (433); dedupe duplicated style constants (tooltip
  style, card shells, axis styles) into styles/shared.ts (S5).
- **Depends on:** F1 merged (else guaranteed conflicts in same files).
- **Acceptance:** vitest green with ZERO test edits; screenshots before/after
  visually identical (review leaf compares).

## Sequencing summary

| Order | Branch | Mode | Why |
|---|---|---|---|
| 1 | G | spawn now | zero deps, unblocks the gate itself |
| 1 | B1 | spawn now (parallel with G) | zero deps, everything else waits on it |
| 2 | B2 | spawn after B1 merge | owns transactions.py; needs B1 schemas |
| 3 | F1 | build parallel w/ B2 ok, merge after B2 | wire-format flip must meet cents endpoints |
| 4 | F2 | spawn after F1 merge | same-file decomposition |

Queue-don't-spawn trigger: if >2 branches would be running concurrently on this
box, hold F1 until B2 finishes (it's last on the critical path anyway).

## Merge-gate mapping (per branch)

1. static: owned-surface diff check vs manifest.json branch_manifests
2. unit: pytest / vitest per branch
3. contract-seam: G's suites against the branch's merged tree
4. integration: full stack boot (dev.sh smoke: `/health` 200, Dashboard renders)
   — required for B2 and F1, optional for others

## Explicitly deferred (do NOT let scope creep into any branch)

Cross-month refund linking, rule-produced splits, person attribution,
AI refund suggestions, auth/multi-user, Postgres/migration tooling,
responsive overhaul. Rationale in DESIGN.md §3 OUT OF SCOPE.
