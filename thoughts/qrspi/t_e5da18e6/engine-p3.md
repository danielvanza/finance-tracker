# Task — FIN-V3-R2 trends endpoint, PHASE 3 only (contract entry + seam tests)

Execute ONLY "Phase 3 — contract entry + seam tests" from
thoughts/qrspi/t_e5da18e6/plan.md. Read plan.md + design.md first (design
Decision 6 governs). Phases 1-2 are done: helper at 54530c0, router at 9c486df
(GET /dashboard/trends lives in backend/routers/dashboard.py — read it so your
tests assert its real behavior).

Work inside /home/hermes/finance-tracker on branch fin-v3-recurring-forecast.
Engine-only: touch NOTHING under frontend/ (the vitest mirror ignores entries
with frontend_caller:null — do not run or change it), no router changes, no
unrelated WIP files (categorizer/*, main.py WIP, alembic*, _e6_probe.py,
runtests.sh, runprobe.sh).

## Scope (the only tracked files you may change)
- contracts/api-contracts.json — insert ONE new endpoint object AFTER the
  "dashboard-summary" object (currently ends ~line 224), BEFORE "settings-get".
- backend/tests/test_contract_seams.py — append one shape-seam test.
- backend/tests/test_dashboard.py — append behavior tests.

## 1. Contract entry (match file's existing style exactly)
```json
{
  "id": "dashboard-trends",
  "method": "GET", "path": "/dashboard/trends",
  "query": {
    "months": "int 1-24 optional (default 12)",
    "end_month": "YYYY-MM optional; default = label month containing today via financial_month_start_day"
  },
  "response": {
    "months_requested": "int (echoed months)",
    "start_month": "YYYY-MM (label of series[0])",
    "end_month": "YYYY-MM (label of last series entry)",
    "series": "[{month, total_expenses_cents, needs_cents, wants_cents, savings_cents, total_income_cents, net_cents, savings_rate_bps, top_categories, mom_deltas}] oldest→newest; savings_rate_bps int|null (null when income <= 0); top_categories [{category_id, category_name, type, actual_cents}] top 5 expense-type; mom_deltas null on series[0] else {total_expenses_cents, needs_cents, wants_cents, savings_cents, total_income_cents, net_cents, savings_rate_bps} signed vs previous entry"
  },
  "error_contract": "422 months outside 1-24 (FastAPI ge/le), 422 malformed end_month ({detail: string})",
  "frontend_caller": null
}
```
After editing: validate JSON parses (python -m json.tool) — a broken substrate
file trips the suppression guard and kills the whole suite.

## 2. Shape-seam test (append to test_contract_seams.py)
`test_seam_dashboard_trends(client)` mirroring test_seam_dashboard_summary's
style: GET ep("dashboard-trends")["path"] with params months=12,
end_month=LABEL_MONTH; assert 200; assert outer keys; every money field is an
int; len(series)==months; series chronological; each entry's keys exactly the
contract set; mom_deltas of series[0] is None; savings_rate_bps is int or None;
top_categories entries have exactly {category_id, category_name, type,
actual_cents}. Use the module's existing LABEL_MONTH constant.

## 3. Behavior tests (append to backend/tests/test_dashboard.py, its client-
fixture style: seed via run_seed + explicit Transaction rows with import_hash,
TestClient via dependency override). Cover, each as its own test with
hand-computed exact cents (use end_month=2026-04 / 2026-05 anchors so values
are deterministic):
a. savings-rate math: April-window income 250000c expenses 6000c -> bps 9760
   (exact); a month with income 0 -> savings_rate_bps null AND that month's
   mom_deltas.savings_rate_bps null even though previous had a rate.
b. MoM deltas: two adjacent constructed months -> signed cent deltas equal
   current-minus-previous for all six cent fields; series[0].mom_deltas None.
c. exclude-type category spend inside the window never appears in any bucket,
   nor in top_categories (seed an exclude-cat tx; assert totals unchanged vs
   without it).
d. refunds net into expenses: -100.00 spend + is_refund=True +40.00 same
   category -> total_expenses_cents == 6000, top_categories actual_cents 6000.
e. unconfirmed transactions ignored entirely.
f. chronological order + windowing: labels strictly oldest→newest ending at
   end_month; a Mar 25 tx lands in label April, a Mar 23 tx in label March
   (start_day=24) — assert via which series entries carry the amounts.
g. validation: ?months=0 and ?months=25 -> 422; ?end_month=2026-13 -> 422
   with string detail.

## Verification (all before commit)
1. python3 -m json.tool contracts/api-contracts.json > /dev/null && echo JSON_OK
2. cd backend && ./runtests.sh -q tests/test_contract_seams.py -q  (route-
   existence test must pass with the new endpoint present)
3. ./runtests.sh -q tests/test_dashboard.py tests/test_financial_month.py -q
4. Full suite ./runtests.sh -q : expect ONLY known failure
   tests/test_categorizer.py::test_time_budget_stops_new_batches; count new
   passing tests and report the number.
5. git status --porcelain must show NO frontend/ or router changes.

## Commit
git add ONLY contracts/api-contracts.json backend/tests/test_contract_seams.py
backend/tests/test_dashboard.py. Message exactly:
test(backend): contract entry + seam tests for /dashboard/trends (t_e5da18e6)

## Report back (final message)
Files changed; commit sha; outputs of steps 1-5 (real output pasted); number of
new tests added per file.
