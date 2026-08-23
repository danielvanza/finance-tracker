Adjudication of your P2 stop-question in /home/hermes/finance-tracker — proceed now with:

RESOLUTION: your option 1. In backend/tests/test_split_part_refunds.py the mixed-refund
fixture ALSO seeds a prior CONFIRMED misc expense of -125.00 dated inside March 2026
(source ing, unique import_hash), mirroring
test_splits.py::test_split_refund_reduces_both_categories. Expected numbers then are:
food actual_cents 12500, misc actual_cents 0 (125 prior − 125 refunded part),
total_expenses_cents 12500, budget rows mirror dashboard. Keep everything else you
verified (response flags [False, True], amount_cents [-12500, -12500], Salary-part 422,
parent-flag NULL-inherit case).

APPROVED: update tests/test_manual_transactions.py line ~128 row["amount"] →
row["amount_cents"] (sum stays == 0).

Execute P2 exactly as your verification summary states, then:
a) cd backend && python -m pytest -q → green, zero failures, xfailed == exactly 1
   (only test_category_type_guard).
b) git add ONLY backend/routers/transactions.py backend/tests/ ; commit with one-shot
   identity flags, subject "B2 P2: ..." ≤72 chars. Nothing else staged.
c) Print summary: files changed, pytest counts, commit hash.
Stop after P2. Do not start P3.
