# Task — FIN-V3-R2 trends endpoint, PHASE 2 only (GET /dashboard/trends router)

Execute ONLY "Phase 2 — GET /dashboard/trends router" from
thoughts/qrspi/t_e5da18e6/plan.md. Read plan.md first, then
thoughts/qrspi/t_e5da18e6/design.md (approved; its JSONC block is the binding
wire shape). Phase 1 is done: `label_month_for_date` exists in
backend/financial_month.py at commit 54530c0 — import and use it.

Work inside /home/hermes/finance-tracker on branch fin-v3-recurring-forecast.
Engine-only: touch NOTHING under frontend/, nothing in contracts/ (phase 3),
no new files under backend/tests/ yet (seam tests are phase 3). Do not touch
the unrelated WIP files (backend/categorizer/*, backend/main.py,
backend/alembic*, frontend WIP) and ignore backend/runtests.sh.

## Scope (the only tracked files you may change)
- backend/routers/dashboard.py — add the trends endpoint below /summary.

## Endpoint contract (binding)
GET /dashboard/trends?months=12[&end_month=YYYY-MM]

Query params:
- months: int = Query(12, ge=1, le=24) — FastAPI returns 422 outside 1..24.
- end_month: optional str; strict datetime.strptime "%Y-%m" else HTTPException
  422 detail string, exactly like summary() does at dashboard.py:22-25.

Anchor label month = parsed end_month, else label_month_for_date(today,
spend_service.get_start_day(db)).

Series = anchor going back (months-1) steps, oldest→newest. Reuse the
month-decrement style already in monthly_trend (dashboard.py:76-81); a tiny
local helper for "label minus k months" is fine — no new module.

Per month (mirror summary's math EXACTLY):
- bounds = spend_service.financial_month_bounds(db, y, m, materialise=True)
- parts = spend_service.confirmed_parts_in_range(db, *bounds)
- Compute cats/exclude set ONCE before the loop (same query as summary :31-33).
- spend_totals = spend_service.spend_totals_by_category(parts, exclude_ids)
  -> total_expenses_cents (sum). Refunds netted inside the seam; savings-type
  allocations count as expenses (summary's definition, design Decision 4).
- income_totals = spend_service.income_totals_by_category(parts, exclude_ids)
  -> total_income_cents (true income only).
- Split over EXPENSE_TYPES using cat_map exactly like summary :67-72:
  needs_cents, wants_cents, savings_cents.
- net_cents = money.to_cents(total_income - total_expenses).
- savings_rate_bps: integer basis points, HALF_UP, computed on the CENTS ints;
  None when income_cents <= 0. Implement as a small private helper
  `_savings_rate_bps(income_cents, expenses_cents)` using divmod half-up
  integer math (no floats): q, r = divmod((income-expenses)*10000, income);
  return q+1 if 2*r >= income else q. Docstring it.
- top_categories: top 5 expense-type categories (types in EXPENSE_TYPES) by
  actual desc, tiebreak category_id asc, from spend_totals via cat_map:
  [{"category_id", "category_name", "type", "actual_cents"}].
- mom_deltas vs the PREVIOUS series entry, embedded; None on series[0]. Keys:
  total_expenses_cents, needs_cents, wants_cents, savings_cents,
  total_income_cents, net_cents (signed cent deltas computed on the emitted
  ints) and savings_rate_bps (signed bps delta; None if either side is None).

Response body (ints only across the wire):
{
  "months_requested": <echoed months>,
  "start_month": "<label of series[0]>",
  "end_month": "<label of last>",
  "series": [ ...entries above, each {"month": "YYYY-MM", ...} ]
}

## Verification (run all, in order, before committing)
1. Unit sanity: .venv/bin/python - <<'PY' calling _savings_rate_bps directly:
   (346026, 6740) -> 9805 (check: (339286*10000)//346026 = 9804 r…, half-up ->
   verify by hand and print); (0, x) -> None; negative income -> None. Paste
   output.
2. Automated probe: write backend/_e6_trends_probe.py (TEMPORARY, delete
   before commit — do NOT touch the existing backend/_e6_probe.py): in-memory
   sqlite via the conftest-style fixture pattern (see tests/conftest.py +
   tests/test_dashboard.py client fixture), seed via run_seed plus explicit
   Transaction rows with import_hash covering two adjacent financial months
   (start_day=24), then TestClient GET /dashboard/trends?months=12&end_month=...
   Assert: status 200; len(series)==12; chronological labels; correct windowing
   of a Mar 25 tx into label April; mom_deltas[0] is None; deltas equal
   current-minus-previous for two constructed months; savings_rate_bps matches
   hand-computed value on your constructed month; exclude-type category totals
   absent everywhere; unconfirmed tx ignored. Run it, paste output. DELETE the
   probe file afterwards (git status must not show it).
3. Full suite: use backend/runtests.sh -q (wrapper for the venv pytest).
   Expected: same baseline as phase 1 — 202 passed, 1 failed ONLY
   tests/test_categorizer.py::test_time_budget_stops_new_batches (pre-approved
   WIP). Any other failure = fix before commit.
4. Live verify: boot uvicorn against a TEMP seeded sqlite db (env var or tmp
   path — follow how backend/db.py picks its file; never touch any real dev
   db file), curl 'http://127.0.0.1:PORT/dashboard/trends?months=12' AND one
   invalid call (?months=0 expecting 422; ?end_month=2026-13 expecting 422),
   paste the JSON (truncated to series[0] and series length) and the 422
   bodies. Kill the server.

## Commit
git add ONLY backend/routers/dashboard.py. Commit message exactly:
feat(backend): add /dashboard/trends monthly series endpoint (t_e5da18e6)

## Report back (final message)
Files changed; commit sha; outputs from verification steps 1-4 (paste real
output); confirmation the probe file was removed.
