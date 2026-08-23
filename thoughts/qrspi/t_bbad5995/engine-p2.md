You are executing ONE qrspi implement phase in /home/hermes/finance-tracker (work there).

Read first:
- thoughts/qrspi/t_bbad5995/plan.md ← working doc; execute ONLY Phase P2, then stop.
- backend/routers/transactions.py (the file you rewrite), backend/schemas.py (READ ONLY —
  you may NOT edit it), backend/spend_service.py, backend/money.py, backend/aggregate.py,
  backend/tests/test_split_refunds.py, tests/test_splits.py, tests/test_refunds.py,
  tests/test_transactions.py, tests/test_manual_transactions.py,
  tests/test_contract_seams.py (ONLY to un-xfail 5 named tests and delete XFAIL_REASON)

HARD BOUNDARIES (merge gate enforces): you may edit ONLY backend/routers/transactions.py
and backend/tests/** (NEW tests/test_split_part_refunds.py + the seam un-xfails).
NEVER touch: schemas.py, models.py, main.py, db.py, money.py, aggregate.py,
adjustments.py, spend_service.py, any other router, frontend/, importers/, categorizer/.
No drive-by refactors.

Follow plan.md Phase P2 exactly. Summary of what P2 delivers:

1. In routers/transactions.py add a ROUTER-LOCAL schema extension (schemas.py is frozen):
   ```python
   class SplitPartIn(SplitIn):
       """v2: optional per-part refund flag. Router-local extension — branch B2
       may not edit schemas.py. None -> DB NULL -> part inherits parent flag."""
       is_refund: Optional[bool] = None

   class TransactionPatchV2(TransactionPatch):
       splits: Optional[list[SplitPartIn]] = None
   ```
   patch_transaction's body parameter becomes `body: TransactionPatchV2` (drop-in via
   inheritance: same field names, same validators).

2. Rebuild `_to_out` on B1's Pydantic models so every transactions endpoint emits the v2
   cents wire format. Use TransactionOut / SplitOut from schemas with populate-by-name
   (pass amount=tx.amount / amount=s.amount — the alias validators convert Decimal to int
   cents). Enum columns need .value unwrapping for source/categorised_by (str-enum guard
   pattern already used in this file). Splits carry the RESOLVED per-part refund flag:
   `tx.is_refund if s.is_refund is None else s.is_refund`. Return
   `.model_dump(by_alias=True)` dicts. All five endpoints (list, review, create,
   adjustment-pair, patch) return through _to_out.

3. list_transactions' month filter switches to
   spend_service.financial_month_bounds(db, year, mo, materialise=True);
   delete this file's local _get_start_day.

4. _apply_splits: row creation becomes
   `TransactionSplit(category_id=s.category_id, amount=s.amount, is_refund=s.is_refund)`.
   Inside the existing validation loop, when s.is_refund is truthy require an expense-type
   category:
   ```python
   if s.is_refund:
       part_cat = _require_category(s.category_id, db)
       if _cat_type(part_cat) not in EXPENSE_TYPES:
           raise HTTPException(status_code=422, detail=(
               f"A refund part must reduce an expense category (needs/wants/savings), "
               f"but '{part_cat.name}' is {_cat_type(part_cat)}"))
   ```
   All existing checks stay exactly as they are (count>=2, sum==parent, non-zero,
   same-sign). The parent-flag _validate_refund tail of patch_transaction stays unchanged.

5. Tests:
   - NEW backend/tests/test_split_part_refunds.py covering plan.md P2 test items:
     mixed split [-125 no flag, -125 is_refund=true] on a -250 parent → response splits
     show resolved flags [False, True] + amount_cents [-12500, -12500]; dashboard food
     actual_cents 12500 / misc actual_cents 0 / total_expenses_cents 12500; budget mirrors;
     refund part targeting Salary → 422; parent-flagged refund with NULL-flag parts →
     response shows both true.
   - Un-xfail in tests/test_contract_seams.py (remove the decorator line ONLY):
     test_seam_transactions_list, test_seam_transactions_next_review,
     test_seam_transaction_create, test_seam_transaction_adjustment_pair,
     test_seam_transaction_patch, AND test_category_type_guard must KEEP its xfail
     (P3 delivers it). After un-xfailing those five, DELETE the now-unused XFAIL_REASON
     constant.
   - Existing tests keep passing without edits except where they assert removed wire keys
     (they shouldn't — verify).

When done:
a) Run `cd backend && python -m pytest -q` — must be green, ZERO failures, xfailed count
   reduced to exactly 1 (only test_category_type_guard remains xfailed).
b) Commit ONLY owned paths: git add backend/routers/transactions.py backend/tests/ &&
   git -c user.name="danielvanza" -c user.email="daniel.van.ziel7@gmail.com" commit
   -m "B2 P2: ..." (subject ≤72 chars). Do NOT git add anything else.
c) Print a summary: files changed, pytest counts, commit hash.

If you hit a mismatch with the plan, STOP and print the mismatch instead of improvising.
