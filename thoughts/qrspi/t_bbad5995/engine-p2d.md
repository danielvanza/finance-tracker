You are RESUMING qrspi phase P2 in /home/hermes/finance-tracker. A previous run completed
MOST of the code work then its session died before finishing. Current verified state:

ALREADY DONE (do NOT redo):
- backend/routers/transactions.py is FULLY rewritten: SplitPartIn/TransactionPatchV2
  subclasses exist; _to_out rebuilt on TransactionOut/SplitOut (.model_dump(by_alias=True),
  resolved per-part refund flags); _apply_splits stores is_refund and rejects refund parts
  on non-expense categories; list_transactions uses spend_service.financial_month_bounds;
  all five endpoints return through _to_out. Verified correct by the orchestrator.

REMAINING WORK (yours):
1. NEW backend/tests/test_split_part_refunds.py — API-level acceptance tests. Fixture:
   run_seed(db); use "Food - Essential" (needs), "Miscellaneous" (wants), "Salary"
   (income). Cases (plan.md P2 + adjudication):
   a. Mixed split WITH prior spend: seed prior CONFIRMED misc expense Decimal("-125.00")
      dated 2026-03-02 inside March 2026 (source ing, unique import_hash). Parent tx
      amount -250.00 dated 2026-03-05 uncategorised unconfirmed. PATCH /transactions/{id}
      json={"confirmed": true, "splits": [
        {"category_id": food.id, "amount_cents": -12500},
        {"category_id": misc.id, "amount_cents": -12500, "is_refund": true}]}
      → 200; body splits have amount_cents [-12500, -12500], is_refund [false, true];
      GET /dashboard/summary?month=2026-03 → food actual_cents 12500, misc actual_cents 0,
      total_expenses_cents 12500; GET /budget?month=2026-03 mirrors (food 12500, misc 0).
   b. Refund part on income category → 422: parent -90.00, splits [food -60 no flag,
      salary +30 is_refund=true]... NOTE sign rule: parts must share parent's sign, so use
      salary part -30 with is_refund=true → expect 422 mentioning expense category.
   c. Parent-flagged refund with NULL-flag parts inherits: parent +90.00 PATCHed
      is_refund=true + splits [food 60, misc 30] (no per-part flags) → response splits
      both is_refund true.
2. Update tests/test_manual_transactions.py line ~128: row["amount"] → row["amount_cents"]
   (the sum == 0 assertion).
3. In tests/test_contract_seams.py remove ONLY these five decorator lines
   (@pytest.mark.xfail(strict=True, reason=XFAIL_REASON)) from:
   test_seam_transactions_list, test_seam_transactions_next_review,
   test_seam_transaction_create, test_seam_transaction_adjustment_pair,
   test_seam_transaction_patch. KEEP test_category_type_guard xfailed.
   Then DELETE the now-unused XFAIL_REASON constant (line ~51).

ENVIRONMENT: run pytest ONLY as
    cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest -q
Another agent may be editing frontend/** concurrently — never read/stage frontend files.

When done:
a) pytest must be green: ZERO failures, exactly 1 xfailed remaining
   (test_category_type_guard).
b) git add ONLY your changed/new backend/tests paths (NOT transactions.py — already
   staged content belongs to this same phase, so DO include
   backend/routers/transactions.py so the phase commits atomically);
   commit via git -c user.name="danielvanza"
   -c user.email="daniel.van.ziel7@gmail.com" commit -m "B2 P2: ..." (subject ≤72 chars).
c) Print: files changed, real pytest counts, commit hash. Stop after P2.
