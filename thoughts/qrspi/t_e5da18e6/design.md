# Design — FIN-V3-R2 spending trends endpoint

> Headless note: qrspi/3_design normally pauses for human answers. This card is
> dispatched autonomously; the task body (research t_b8cd7b84) already fixes the
> material decisions — endpoint path, `months` param, buckets, seams, engine-only
> scope, acceptance. Remaining choices below are implementation-level and grounded
> in cited codebase patterns. Recorded here instead of blocking.

## Current State

- `/dashboard/summary?month=YYYY-MM` (backend/routers/dashboard.py:19) renders ONE
  financial month: income/expenses/savings totals, needs/wants/savings split,
  category breakdowns, plus a thin 6-entry `monthly_trend` of `{month,total_cents}`
  (dashboard.py:74-88) — expenses only, no income/net/rate/deltas.
- All aggregation flows through `backend/spend_service.py`: `financial_month_bounds`
  (:21), `confirmed_parts_in_range` (:30), `spend_totals_by_category` (refunds netted
  via aggregate.spend_contribution), `income_totals_by_category` (:52).
- Effective-parts rule (backend/aggregate.py:12): splits replace parent; refund parts
  net against spend. Exclude-type categories are dropped by passing their ids as
  `skip_cat_ids` (dashboard.py:33).
- Money crosses the wire as integer cents (`*_cents`) via money.to_cents
  (backend/money.py:13) — v2 contract, enforced by tests.
- Contract substrate: contracts/api-contracts.json drives backend/tests/test_contract_seams.py
  (every endpoint id must exist as a route + round-trip in declared shape) and
  frontend/src/tests/contract.test.ts. The frontend mirror ONLY enforces entries with
  a non-null `frontend_caller` (contract.test.ts:79-87) — engine-only endpoints can be
  added with `frontend_caller: null` without touching api.ts.
- Test conventions: function-scoped in-memory SQLite `db` fixture (tests/conftest.py),
  TestClient with dependency override + `run_seed` (tests/test_dashboard.py:11),
  seam-shape asserts (test_contract_seams.py:692).

## Desired End State

`GET /dashboard/trends?months=12[&end_month=YYYY-MM]` returns a series of per-
financial-month analytics, oldest→newest, ending at `end_month` (default: the label
month containing today):

```jsonc
{
  "months_requested": 12,           // echoed, clamped
  "start_month": "2025-09",         // label month of series[0]
  "end_month": "2026-08",
  "series": [{
    "month": "2026-04",
    "total_expenses_cents": 6740,   // needs+wants+savings, excludes-type dropped, refunds netted — identical math to summary.total_expenses
    "needs_cents": 6740, "wants_cents": 0, "savings_cents": 0,
    "total_income_cents": 346026,   // true income only (income_totals_by_category)
    "net_cents": 339286,            // income - expenses
    "savings_rate_bps": 9805,       // round_half_up((income-expenses)/income * 10000); null when income <= 0
    "top_categories": [             // top 5 expense-type cats by actual, refunds netted
      {"category_id": 1, "category_name": "Food - Essential", "type": "needs", "actual_cents": 6740}
    ],
    "mom_deltas": {                 // vs previous series entry; null on series[0]
      "total_expenses_cents": -2000, "needs_cents": -2000, "wants_cents": 0,
      "savings_cents": 0, "total_income_cents": 0, "net_cents": 2000,
      "savings_rate_bps": 123
    }
  }]
}
```

Acceptance (from task): pytest green including new tests; 12-month series with
correct savings-rate math on seeded data.

## Patterns to Follow

- Router stays THIN: parse params → call spend_service seams → shape dict with
  money.to_cents. No hand-rolled part loops in the router (spend_service.py:1-5
  docstring is a hard rule).
- Per-month iteration calling `financial_month_bounds(db, y, m)` +
  `confirmed_parts_in_range` mirrors the existing `monthly_trend` loop
  (dashboard.py:76-88). Scale is personal-finance small; simplicity beats a
  bespoke dated-parts refactor. NOT following: any new aggregation helper outside
  spend_service for logic that already exists there.
- Month arithmetic helper: reuse/extend backend/financial_month.py (label-month
  inverse of start_day) rather than inline while-loops beyond what :79-81 does.
- Wire format: integer cents / integer bps only; no floats, no Decimal in JSON.
- Validation errors: HTTPException 422 with detail string (dashboard.py:24-25).
- Tests: seed via run_seed + explicit Transaction rows with import_hash, assert on
  exact cents ints (test_dashboard.py fixtures are the template).

## Design Decisions

1. **Anchor + `end_month` param**: series ends at the label month containing
   today when `end_month` absent; optional explicit `end_month=YYYY-MM` exists
   SOLELY for deterministic tests and future consumers. Fixed signature
   `?months=12` still works — default preserved. (Task fixes the path; this adds
   an optional param, doesn't change it.)
2. **Savings rate in integer basis points**, HALF_UP, computed on cents ints;
   `null` when income ≤ 0 (rate undefined/negative-income months meaningless).
   Avoids floats entirely; frontend can render % by /100.
3. **MoM deltas EMBEDDED per entry** (vs separate array): consumer reads one
   entry without index alignment; series[0] carries `mom_deltas: null`.
   Delta = current − previous, signed cents (signed bps for the rate).
4. **Expenses definition = summary's definition** (task mandate "exactly as
   dashboard.summary"): spend_totals over all non-exclude categories — savings-
   type allocations count as expenses (pay-yourself-first accounting, consistent
   with summary.left_over). Income is true income only.
5. **Standing adjustments materialised per covered label month**
   (`materialise=True` per iteration, same call sites as today) IF idempotent —
   verified against backend/adjustments.py before implement; fallback: materialise
   current month only, documented in contract. Recurring items must appear in
   history months or trends lie.
6. **Contract substrate updated**: append `dashboard-trends` endpoint to
   contracts/api-contracts.json with `frontend_caller: null`; backend seam suite
   gains automatic route-existence coverage + a hand-written shape seam test.
   Vitest untouched (mirror skips null callers). FIN-V3 flips the caller later.
7. **Param validation**: `months` int 1..24 (FastAPI Query ge/le → 422 outside);
   `end_month` strict `%Y-%m` strptime else 422 (copy dashboard.py:22-25).

## What We're NOT Doing

- No frontend changes: no api.ts caller, no components, no dashboard repo edits
  (explicit task boundary; t_c586285e consumes later).
- No new models/tables/migrations; no schema.json delta (no DB change).
- No forecasting, averaging, or rolling windows — raw monthly facts only.
- No caching layer; per-month seam calls are fine at this scale.
- No changes to /summary behaviour or its contract entry.

## Risk Resolutions (verified pre-implement)

- Standing adjustments: materialise_standing_adjustments (backend/adjustments.py)
  is idempotent (exists-check :27-33, opt-out-by-delete preserved) and
  past-month-safe (:17-18 skips FUTURE months only). Decision 5 confirmed:
  call financial_month_bounds(materialise=True) for EVERY series month so
  recurring net-zero pairs appear across history.
- Label-month inverse helper does not exist (financial_month.py has only
  get_financial_month_range). Implement phase adds
  `label_month_for_date(d, start_day) -> (year, month)` next to it:
  start_day==1 → calendar month; else d.day >= start_day → next month,
  else same month.
