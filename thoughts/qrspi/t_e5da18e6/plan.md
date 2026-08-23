# Plan — FIN-V3-R2 trends endpoint (t_e5da18e6)

Design authority: design.md in this dir (committed fc873e0, design-gate PASS).
Baseline: pytest 196 passed / 1 pre-existing failure (test_categorizer.py::test_time_budget_stops_new_batches
— another task's uncommitted WIP in categorizer/ai.py + its tests; NOT this task's surface).
Engine work happens in /home/hermes/finance-tracker on top of that baseline.

## Phase 1 — label-month inverse helper
- [x] Add `label_month_for_date(d: date, start_day: int) -> tuple[int, int]` to
      backend/financial_month.py (start_day==1 → calendar month; d.day >= start_day
      → next label month; else same label month). Pure function, no I/O.
- [x] Unit tests in backend/tests/test_financial_month.py mirroring existing style:
      start_day=1 identity, day>=start_day rollover, day<start_day same-month,
      December→January year rollover.
- [x] Automated verify: `backend/.venv/bin/python -m pytest tests/test_financial_month.py -q` green.
- [x] Live verify: python -c round-trip check — get_financial_month_range(y,m,24) ∘
      label_month_for_date(bounds, 24) == (y,m) for several months incl. Jan/Dec edges.
- [x] Commit phase 1.

## Phase 2 — GET /dashboard/trends router
- [ ] Add endpoint to backend/routers/dashboard.py per design.md: `months` Query ge=1
      le=24; optional `end_month` strict %Y-%m else 422; anchor = end_month or today's
      label month (label_month_for_date(today, start_day)); iterate oldest→newest;
      financial_month_bounds(materialise=True) per month; confirmed_parts_in_range;
      spend_totals_by_category/income_totals_by_category with exclude-type skip set
      (identical to summary); needs/wants/savings split; savings_rate_bps half-up int,
      None when income<=0; top-5 expense cats by actual desc (id tiebreak asc);
      mom_deltas embedded, None on first entry.
- [ ] Wire format: ints only (*_cents, *_bps); no floats cross the wire.
- [ ] Automated verify: quick TestClient probe script on seeded data — 12 entries,
      exact expected cents/bps on a constructed month, mom_deltas[0] is None.
- [ ] Live verify: boot uvicorn against a temp seeded sqlite DB, curl
      /dashboard/trends?months=12, inspect JSON.
- [ ] Commit phase 2.

## Phase 3 — contract entry + seam tests
- [ ] Append `dashboard-trends` endpoint to contracts/api-contracts.json
      (GET /dashboard/trends, query months/end_month documented, response shape,
      frontend_caller: null so the frontend mirror ignores it).
- [ ] Hand-written contract-seam-style tests (test_dashboard.py, matching fixture
      patterns): shape of every field, savings-rate math incl. income<=0 → null,
      MoM deltas math, exclude-type categories never appear, refunds net into
      expenses, unconfirmed transactions ignored, months clamp/validation 422s,
      chronological order + correct financial-month windowing (start_day=24).
- [ ] Automated verify: full backend suite green except the recorded pre-existing
      categorizer failure; new tests all pass.
- [ ] Live verify: rerun the uvicorn+curl probe after contract change (route still
      serves; route-existence also enforced by test_contract_seams automatically).
- [ ] Commit phase 3.

## Phase 4 — merge gate
- [ ] Run ~/.hermes/fleet/merge-gate.py with this task as input; resolve any heal
      ticket by re-applying against fresh base.
- [ ] Final report: what changed, evidence (pytest counts, gate verdict, curl output).

## Not doing
- Frontend/api.ts/dashboard repo changes (task boundary).
- New models/migrations; caching; forecasting; changes to /summary.
