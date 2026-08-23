# Task — FIN-V3-R2 trends endpoint, PHASE 1 only (label-month inverse helper)

Execute ONLY "Phase 1 — label-month inverse helper" from
thoughts/qrspi/t_e5da18e6/plan.md. Read plan.md first, then
thoughts/qrspi/t_e5da18e6/design.md (approved design; "Risk Resolutions" last
bullet specifies this helper's exact semantics). Do NOT start Phase 2 or 3.

Work inside /home/hermes/finance-tracker on branch fin-v3-recurring-forecast.
Engine-only task: touch NOTHING under frontend/ and nothing outside backend/.

## Scope (the only files you may change)
- backend/financial_month.py — add:
  `label_month_for_date(d: date, start_day: int) -> tuple[int, int]`
  Inverse of get_financial_month_range: returns the financial-month label (year,
  month) whose range [get_financial_month_range(y, m, start_day)] contains d.
  Semantics per design.md: validate 1 <= start_day <= 28 (ValueError, matching
  existing style); start_day == 1 -> (d.year, d.month); d.day >= start_day ->
  next label month after (d.year, d.month); else same (d.year, d.month).
  December -> January must roll the year. Pure function, no I/O, full docstring
  in the file's existing docstring style.
- backend/tests/test_financial_month.py — add unit tests mirroring the file's
  existing style (function-local imports, plain asserts):
  * start_day=1 identity (any date maps to its calendar month);
  * day >= start_day rolls to NEXT label month (e.g. 2026-03-24 with start_day
    24 -> (2026, 4));
  * day < start_day stays same label month (e.g. 2026-04-10 with start_day 24
    -> (2026, 4) is WRONG — expect (2026, 3)); write the assertion to the
    inverse-of-range truth, not to intuition;
  * December->January year rollover both ways;
  * round-trip property: for a spread of (year, month, start_day) incl. Jan/Dec
    edges, get_financial_month_range(y,m,sd) bounds fed through
    label_month_for_date(.., sd) return (y,m) — check BOTH endpoints of each
    range.

## Verification (run all, before committing)
1. cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest
   tests/test_financial_month.py -q   -> all green
2. .venv/bin/python -m pytest -q     -> full suite; record tail counts. Known
   pre-existing failure allowed ONLY if it is
   tests/test_categorizer.py::test_time_budget_stops_new_batches (another
   task's WIP). Any other new failure = fix before commit.
3. Live round-trip probe (must actually run, paste output):
   .venv/bin/python -c loop over months [(2025,12),(2026,1),(2026,4),(2026,12)]
   x start_days [1,15,24,28]: compute bounds via get_financial_month_range,
   assert label_month_for_date on both bounds == (y,m), print one line per
   combo "OK (y,m,sd)".

## Commit
git add ONLY backend/financial_month.py backend/tests/test_financial_month.py
Commit message exactly:
feat(backend): add label_month_for_date inverse helper (t_e5da18e6)

## Report back (final message)
Files changed; commit sha; pytest tails for steps 1+2; probe output lines.
