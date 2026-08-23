You are executing qrspi phase P3 in /home/hermes/finance-tracker.

ENVIRONMENT: run tests ONLY as
    cd /home/hermes/finance-tracker/backend && .venv/bin/python -m pytest -q
(bare `python` is a Hermes venv without pytest). Another agent may be editing
frontend/** concurrently — ignore frontend/** entirely; never read or stage it.

Read first:
- thoughts/qrspi/t_bbad5995/plan.md ← working doc; execute ONLY Phase P3, then stop.
- backend/routers/categories.py (the file you modify), backend/tests/test_categories.py,
  backend/tests/test_contract_seams.py (ONLY to un-xfail test_category_type_guard)

HARD BOUNDARIES: edit ONLY backend/routers/categories.py, NEW
backend/tests/test_category_type_guard.py, and tests/test_contract_seams.py
(remove ONLY the xfail decorator above test_category_type_guard).
NEVER touch schemas/models/main/db/money/aggregate/adjustments/spend_service,
other routers, or frontend/**. No drive-by refactors.

What P3 delivers (plan.md Phase P3):

1. routers/categories.py:
   - CategoryPatch gains `force: bool = False`.
   - Extract delete_category's four usage queries VERBATIM into
     `_usage_counts(db, category_id) -> dict` returning
     {"transaction": n, "split": n, "rule": n, "standing adjustment": n};
     delete_category now calls _usage_counts and keeps its exact message format.
   - patch_category guard: when body.type parses successfully AND
     CategoryType(body.type) != cat.type:
       counts = _usage_counts(db, category_id)
       blockers = {label: n for label, n in counts.items() if n > 0}
       if blockers and not body.force:
           parts = ", ".join(f"{n} {label}(s)" for label, n in blockers.items())
           raise HTTPException(status_code=422, detail=(
               f"Cannot change type of '{cat.name}' to '{body.type}': "
               f"in use by {parts}. Reassign or remove them first, or pass force:true."))
     Invalid type string still 422s with the existing parse-error detail BEFORE any census.
     Rename-only patches and same-type patches bypass the guard entirely.
     No budget-row creation/removal anywhere in patch_category.
     Single db.commit() at the end as today (no partial commits).

2. NEW backend/tests/test_category_type_guard.py with plan.md's eight cases a–h
   (blocked by rule / transaction / split / standing adjustment with census wording in
   detail + type unchanged in DB; force:true flips type leaving dependents untouched;
   no-dependents flip needs no force; rename-only on a used category stays 200; invalid
   type on used category gives parse-error not census).

3. Un-xfail test_category_type_guard in tests/test_contract_seams.py (remove its
   @pytest.mark.xfail(strict=True, reason=XFAIL_REASON) decorator line only).

When done:
a) cd backend && .venv/bin/python -m pytest -q → green, ZERO failures, ZERO xfailed.
b) git add ONLY backend/routers/categories.py backend/tests/test_category_type_guard.py
   backend/tests/test_contract_seams.py; commit via git -c user.name="danielvanza"
   -c user.email="daniel.van.ziel7@gmail.com" commit -m "B2 P3: ..." (subject ≤72 chars).
c) Print summary: files changed, real pytest counts, commit hash.
Stop after P3. If anything mismatches, STOP and print the mismatch.
