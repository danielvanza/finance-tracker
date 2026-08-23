You are executing qrspi phase P2 in /home/hermes/finance-tracker. A previous attempt
aborted BEFORE making any edits (it could not run pytest). You start fresh.

ENVIRONMENT FIX (the reason the last attempt aborted): bare `python` resolves to a
Hermes-agent venv WITHOUT pytest. ALWAYS run tests as:
    cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest -q
(or `source .venv/bin/activate` first). Never bare `python`/`python3`.

CONCURRENCY RULE: another agent is simultaneously editing frontend/** (branch F1).
Ignore any frontend/** files — read none of them, touch none of them, never stage them.
Your git adds must list ONLY your own backend paths explicitly.

Read first:
- thoughts/qrspi/t_bbad5995/plan.md ← working doc; execute ONLY Phase P2, then stop.
- thoughts/qrspi/t_bbad5995/engine-p2.md ← the FULL P2 specification you must follow
  (boundaries, SplitPartIn/TransactionPatchV2 design, _to_out rebuild on TransactionOut/
  SplitOut, spend_service.financial_month_bounds switch, _apply_splits is_refund,
  new test_split_part_refunds.py, which 5 seam tests to un-xfail — KEEPING
  test_category_type_guard xfailed — and deleting XFAIL_REASON afterwards).
- thoughts/qrspi/t_bbad5995/engine-p2b.md ← adjudication amendments:
  * the mixed-refund API fixture ALSO seeds a prior CONFIRMED misc expense of -125.00
    inside March 2026 → expected food actual_cents 12500, misc actual_cents 0,
    total_expenses_cents 12500, budget mirrors;
  * update tests/test_manual_transactions.py line ~128 row["amount"] → row["amount_cents"]
    (sum stays == 0).

HARD BOUNDARIES: edit ONLY backend/routers/transactions.py and backend/tests/**
(NEVER schemas.py, models.py, main.py, db.py, money.py, aggregate.py, adjustments.py,
spend_service.py, other routers, frontend/**). No drive-by refactors.

When done:
a) cd backend && .venv/bin/python -m pytest -q → green, ZERO failures,
   exactly 1 xfailed remaining (test_category_type_guard).
b) git add ONLY backend/routers/transactions.py and the specific backend/tests files you
   changed; commit with git -c user.name="danielvanza"
   -c user.email="daniel.van.ziel7@gmail.com" commit -m "B2 P2: ..." (subject ≤72 chars).
c) Print summary: files changed, real pytest counts, commit hash.
Stop after P2. If anything mismatches the spec, STOP and print the mismatch.
