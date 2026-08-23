You are executing ONE qrspi implement phase in /home/hermes/finance-tracker (work there).

Read first:
- thoughts/qrspi/t_bbad5995/plan.md ← working doc; execute ONLY Phase P1, then stop.
- backend/routers/dashboard.py, backend/routers/budget.py (the two files you rewrite),
  backend/money.py, backend/aggregate.py, backend/schemas.py,
  backend/tests/test_dashboard.py, tests/test_budget.py, tests/test_refunds.py,
  tests/test_splits.py, tests/test_manual_transactions.py,
  backend/tests/test_contract_seams.py (ONLY to un-xfail 4 named tests)

HARD BOUNDARIES (merge gate enforces): you may edit ONLY:
- NEW file backend/spend_service.py
- backend/routers/dashboard.py, backend/routers/budget.py
- backend/tests/** (test_dashboard.py, test_budget.py, test_refunds.py, test_splits.py,
  test_manual_transactions.py money-field updates; NEW tests/test_spend_service.py;
  test_contract_seams.py ONLY removing @pytest.mark.xfail(strict=True, reason=XFAIL_REASON)
  from these four: test_seam_budget_get, test_seam_budget_patch_month,
  test_seam_budget_patch_default, test_seam_dashboard_summary — leave XFAIL_REASON constant
  defined, P2 still uses it)
NEVER touch: schemas.py, models.py, main.py, db.py, money.py, aggregate.py, adjustments.py,
any other router, frontend/, importers/, categorizer/. No drive-by refactors.

Follow plan.md Phase P1 exactly. The critical correctness rules:
1. NEVER put a raw Decimal in a response dict — FastAPI renders it as float and the seam
   tests assert isinstance(x, int). Convert every monetary value with money.to_cents().
2. Response key renames are contractual: total_income_cents / total_expenses_cents /
   total_savings_cents / left_over_cents; category_breakdown items {category_id,
   category_name, actual_cents, planned_cents, type}; income_breakdown items amount_cents;
   needs_wants_savings keys needs_cents/wants_cents/savings_cents; monthly_trend entries
   {month, total_cents}; budget rows {id, category_id, category_name, category_type, month,
   planned_amount_cents, actual_amount_cents}. Legacy non-cents keys must be GONE.
3. spend_service.py is a pure extraction: identical arithmetic, identical ordering, identical
   filtering semantics as the loops being deleted. Use aggregate.spend_contribution for
   signed spend sums (equals -amount on all pre-v2 cases) and keep is_spend_part gating.
   left_over computed in Decimal then converted once.
4. budget PATCH endpoints + dashboard keep their exact status codes/404s; only money fields
   rename to *_cents.
5. Test edits: update ONLY money-field assertions (units change per contract v2). Do not
   touch any other assertion or test. Exact expected values are listed in plan.md P1.

When done:
a) Run `cd backend && python -m pytest -q` — must be green with ZERO failures and xfailed
   count reduced from 10 to exactly 6. Report the real numbers.
b) Commit ONLY your owned paths: git add backend/spend_service.py backend/routers/dashboard.py
   backend/routers/budget.py backend/tests/ && git -c user.name="danielvanza"
   -c user.email="daniel.van.ziel7@gmail.com" commit -m "B2 P1: ..." (subject ≤72 chars).
   Do NOT git add anything else (no thoughts/, no contracts/).
c) Print a summary: files changed, pytest counts (passed/failed/xfailed), commit hash.

If you hit a mismatch with the plan, STOP and print the mismatch instead of improvising.
