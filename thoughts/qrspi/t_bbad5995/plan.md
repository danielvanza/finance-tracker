# FIN-B2 — backend routers + spend_service (v2 wire completion + S1 guard + split refunds)

Task: t_bbad5995 · repo /home/hermes/finance-tracker · branch main (direct commits, established pattern)
Parent B1 merged at f1f0a16. Baseline verified by orchestrator: **167 passed, 10 xfailed**
(the 10 xfails in tests/test_contract_seams.py ARE this branch's deliverables — 9 wire-format
flips + 1 category-type guard, all `xfail(strict)`).

## Owned / forbidden (merge gate enforces)
- MAY TOUCH: `backend/routers/**`, NEW `backend/spend_service.py`, `backend/tests/**`,
  `thoughts/qrspi/t_bbad5995/**`
- MUST NOT TOUCH: `frontend/**`, `backend/models.py`, `backend/schemas.py`,
  `backend/main.py`, `backend/money.py`, `backend/aggregate.py`, `backend/db.py`,
  `backend/importers/**`, `backend/categorizer/**`
- `backend/adjustments.py` is in the manifest but needs NO changes — do not edit it.

## Contract decisions (recorded for review)
1. **Routers emit plain dicts with `*_cents` int values**, converted exclusively via
   `money.to_cents()` at dict-construction time. NEVER place a raw `Decimal` in a response
   dict: FastAPI's jsonable_encoder renders Decimal as float (`6740.0`), which fails the
   seam suite's `isinstance(x, int)` assertions. B1's Pydantic Out models are USED where they
   fit (transactions: `TransactionOut`/`SplitOut` via `.model_dump(by_alias=True)`);
   budget/dashboard rows stay hand-built dicts because `schemas.BudgetRow` lacks
   `category_type` (contract requires it) and B2 cannot edit schemas.py.
2. **SplitIn per-part refund input enters via a router-local subclass**
   (schemas.py frozen for B2; SplitOut.is_refund already shipped in B1):
   ```python
   class SplitPartIn(SplitIn):
       """v2: optional per-part refund flag. Router-local extension — branch B2
       may not edit schemas.py. None -> DB NULL -> part inherits parent flag."""
       is_refund: Optional[bool] = None

   class TransactionPatchV2(TransactionPatch):
       splits: Optional[list[SplitPartIn]] = None
   ```
   `patch_transaction` takes `TransactionPatchV2`; `_apply_splits` stores
   `is_refund=s.is_refund` on the row (None → NULL → aggregate.effective_parts
   parent-fallback, already implemented in B1).
3. **Per-part refund validation**: a part with `is_refund=True` must target an expense-type
   category (needs/wants/savings) — same rule/message style as `_validate_refund`. Part sign
   rules unchanged (share parent sign). No parent-flag coupling.
4. **Type-guard census = EXACT reuse of delete_category's four counts** (transaction, split,
   rule, standing adjustment), per task body "reuse delete_category counts". Guard fires only
   when `body.type` is present AND differs from current type. Any count > 0 → 422 listing
   counts unless `force: true`. Sign-compatibility refinement of the census is OUT OF SCOPE
   (reported, not built). No budget-row side effects on type change (R4: new changes only).
   `CategoryPatch` already lives in routers/categories.py — add `force: bool = False` there.
5. **spend_service.py is the single aggregation seam** (kills the three hand-rolled loops +
   the triplicated `_get_start_day`). Pure extraction — identical arithmetic, order, and
   rounding; parity is proven by tests asserting exact cent values on the same fixtures the
   pre-refactor suite used (e.g. 3460.26 → 346026).
6. **Trend stays 6 separate range queries** composed through the shared builder (behaviour-
   preserving; single-query optimisation is out of scope).

## Phases

### P1 — spend_service.py + dashboard/budget rewire onto it + their cents flip
- [ ] NEW `backend/spend_service.py`:
  ```python
  """Shared aggregation queries for the dashboard/budget/transactions routers.

  Single seam for: financial-month bounds, the confirmed-transactions query,
  and effective-parts grouping (S4). Every total in the app flows through here;
  routers must not hand-roll these loops."""
  from decimal import Decimal
  from sqlalchemy.orm import Session, selectinload
  from models import Transaction, Setting
  from financial_month import get_financial_month_range
  from aggregate import effective_parts, is_spend_part, spend_contribution
  from adjustments import materialise_standing_adjustments

  DEFAULT_START_DAY = 24

  def get_start_day(db: Session) -> int:
      setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
      return int(setting.value) if setting else DEFAULT_START_DAY

  def financial_month_bounds(db, year, mo, materialise=False):
      """(start_date, end_date) for label month year-mo; optionally materialises
      standing adjustments first (same call sites as today)."""
      start_day = get_start_day(db)
      if materialise:
          materialise_standing_adjustments(year, mo, start_day, db)
      return get_financial_month_range(year, mo, start_day)

  def confirmed_parts_in_range(db, start_date, end_date):
      txs = db.query(Transaction).options(selectinload(Transaction.splits)).filter(
          Transaction.date >= start_date,
          Transaction.date <= end_date,
          Transaction.confirmed == True,  # noqa: E712 — historic form
      ).all()
      return [p for t in txs for p in effective_parts(t)]

  def spend_totals_by_category(parts, skip_cat_ids=frozenset()):
      """category_id -> spend contribution (refunds netted) for spend-bearing
      parts outside skip_cat_ids. Mirrors the former dashboard/budget loops:
      is_spend_part(amount, refund) gates, spend_contribution signs."""
      totals: dict[int, Decimal] = {}
      for cid, amount, refund in parts:
          if cid is None or cid in skip_cat_ids:
              continue
          if is_spend_part(amount, refund):
              totals[cid] = totals.get(cid, Decimal("0")) + spend_contribution(amount, refund)
      return totals

  def income_totals_by_category(parts, skip_cat_ids=frozenset()):
      """category_id -> sum of positive, non-refund parts (true income only)."""
      totals: dict[int, Decimal] = {}
      for cid, amount, refund in parts:
          if cid is None or cid in skip_cat_ids:
              continue
          if amount > 0 and not refund:
              totals[cid] = totals.get(cid, Decimal("0")) + amount
      return totals
  ```
  NOTE: spend_contribution(-abs refund) == historic `-amount` for every case the old
  loops handled; B1 proved equivalence (test_money/test_split_refunds). Parity tests pin it.
- [ ] REWRITE `backend/routers/dashboard.py::summary` to:
  - parse month (unchanged 422), call `financial_month_bounds(db, y, m, materialise=True)`
  - parts = `confirmed_parts_in_range(...)`
  - exclude_ids from Category.type == "exclude"; cat_map as today
  - `spend_totals = spend_service.spend_totals_by_category(parts, exclude_ids)`;
    `total_expenses = sum(spend_totals.values())`
  - `income_totals = spend_service.income_totals_by_category(parts, exclude_ids)`;
    `total_income = sum(income_totals.values())`
  - expense_breakdown = {cid: v for cid, v in spend_totals.items() if cat_map[cid].type in NWS}
  - income_breakdown filtered to income type from income_totals
  - total_savings = sum over spend_totals for savings-typed cids; needs/wants sums from
    expense_breakdown by type (identical grouping to today)
  - trend: for i in 5..0 → bounds WITHOUT materialise → confirmed_parts_in_range →
    spend_totals_by_category(parts, exclude_ids) → sum → to_cents
  - RESPONSE KEYS (all money via `money.to_cents` → int):
    `month`, `total_income_cents`, `total_expenses_cents`, `total_savings_cents`,
    `left_over_cents` (= income − expenses, computed in DECIMAL then to_cents),
    `category_breakdown`: [{category_id, category_name, actual_cents, planned_cents, type}],
    `income_breakdown`: [{category_id, category_name, amount_cents}],
    `needs_wants_savings`: {needs_cents, wants_cents, savings_cents},
    `monthly_trend`: [{month, total_cents}] — legacy keys GONE (seam asserts absence).
- [ ] REWRITE `backend/routers/budget.py::get_budget` to use the service:
  bounds(materialise=True) → parts → `skip = {income, exclude} ids` →
  `spend_totals_by_category(parts, skip)` → actual per row. Response rows become
  `{id, category_id, category_name, category_type, month, planned_amount_cents,
  actual_amount_cents}` — cents ints via to_cents; `month` stays `date` object
  (FastAPI renders ISO, as today). `_auto_populate` and both PATCH endpoints: response
  money keys → `planned_amount_cents` (to_cents of stored Decimal). Delete local
  `_get_start_day`.
- [ ] DELETE local `_get_start_day` from dashboard.py (service owns it);
  transactions.py keeps its own until P2 (its list endpoint intentionally does NOT filter
  confirmed and only needs bounds — P2 moves it to `financial_month_bounds`).
- [ ] Tests:
  - UPDATE money-field assertions ONLY (units change per contract v2; B1 precedent):
    tests/test_dashboard.py (totals ×100 as ints; income_breakdown amount→amount_cents;
    nws needs→needs_cents; trend total→total_cents), tests/test_budget.py
    (actual_amount→actual_amount_cents == 10000; patch sends int cents, asserts _cents),
    tests/test_refunds.py (dashboard totals/actual/nws/trend → *_cents: 100000, 15000,
    150000→food_row actual_cents 15000, nws needs_cents 15000; over-refunded budget
    actual_amount_cents == -5000; budget_actuals 15000; trend total_cents 18000),
    tests/test_splits.py (breakdown actual→actual_cents 12500; nws needs_cents/wants_cents
    12500; total_expenses_cents 25000; budget actual_amount_cents == 12500),
    tests/test_manual_transactions.py (pair rows: `sum(row["amount_cents"] for row in rows)==0`;
    dashboard totals → 360000/60000/300000; wants_cents 60000).
    Do NOT touch non-money assertions.
  - NEW `backend/tests/test_spend_service.py`:
    a. parity: seed the EXACT test_dashboard fixture trio (-67.40 AH, 3460.26 salary,
       -20.00 Bol.com Mar 23) → /dashboard/summary?month=2026-04 asserts
       total_income_cents == 346026, total_expenses_cents == 6740, left_over_cents == 339286,
       trend[-1]["total_cents"] present & int, trend[-1]["month"]=="2026-04";
       /budget?month=2026-04 Food actual_amount_cents == 0 (no April txns) and
       ?month=2026-03 sees only the -20.00 → -2000.
    b. unit: spend_totals skips cid None + skip set; refund part nets (is_spend_part path);
       income_totals ignores refunds & negatives; empty parts → {}.
    c. mixed-refund split THROUGH THE API later in P2 — here assert service-level: parts from
       a NULL/explicit-flag split produce net-zero contributions (mirrors test_split_refunds).
  - UN-XFAIL (remove @pytest.mark.xfail line + reason usage) in test_contract_seams.py:
    test_seam_budget_get, test_seam_budget_patch_month, test_seam_budget_patch_default,
    test_seam_dashboard_summary. Leave XFAIL_REASON constant (P2 still uses it).
- [ ] Verify: `cd backend && python -m pytest -q` → all green, 0 failed, xfails down to 6.
      Commit `B2 P1:` (one-shot identity flags, add only owned paths).

### P2 — transactions router: v2 wire + split-part refunds (S2-at-the-API)
- [ ] `backend/routers/transactions.py`:
  - `_to_out` rebuilt on B1 models:
    ```python
    from schemas import TransactionOut, SplitOut
    def _to_out(tx: Transaction) -> dict:
        return TransactionOut(
            id=tx.id, date=tx.date, amount=tx.amount, description=tx.description,
            source=tx.source.value if hasattr(tx.source, "value") else str(tx.source),
            category_id=tx.category_id,
            category_name=tx.category.name if tx.category else None,
            confirmed=tx.confirmed,
            categorised_by=(tx.categorised_by.value if hasattr(tx.categorised_by, "value")
                            else str(tx.categorised_by)) if tx.categorised_by else None,
            ai_confidence=tx.ai_confidence, is_refund=tx.is_refund,
            standing_adjustment_id=tx.standing_adjustment_id,
            splits=[SplitOut(
                id=s.id, category_id=s.category_id,
                category_name=s.category.name if s.category else None,
                amount=s.amount,
                is_refund=(tx.is_refund if s.is_refund is None else s.is_refund),
            ) for s in tx.splits],
        ).model_dump(by_alias=True)
    ```
    (amount=tx.amount feeds the AliasChoices legacy name; validator converts to cents int.)
  - `list_transactions` + `next_review` + `create_transaction` + `create_adjustment_pair` +
    `patch_transaction` all return `_to_out(...)` (unchanged call sites).
  - month filter in list_transactions → `spend_service.financial_month_bounds(db, y, mo,
    materialise=True)`; delete local `_get_start_day`.
  - Add `SplitPartIn`/`TransactionPatchV2` (decision 2 above); `patch_transaction` body
    becomes `TransactionPatchV2` (drop-in: same field names/validators via inheritance).
  - `_apply_splits(tx, splits, db)`: unchanged checks; row creation gains
    `is_refund=s.is_refund`; NEW validation inside the loop:
    ```python
    if s.is_refund:
        part_cat = _require_category(s.category_id, db)
        if _cat_type(part_cat) not in EXPENSE_TYPES:
            raise HTTPException(status_code=422, detail=(
                f"A refund part must reduce an expense category (needs/wants/savings), "
                f"but '{part_cat.name}' is {_cat_type(part_cat)}"))
    ```
  - patch_transaction tail `_validate_refund` block unchanged (parent-flag path).
- [ ] Tests:
  - NEW `backend/tests/test_split_part_refunds.py` (API-level, the acceptance-critical case):
    parent -250.00 expense PATCHed with splits [food −125.00 (no flag), misc −125.00
    is_refund=true] → 200; response splits carry is_refund [false, true] and
    amount_cents [-12500, -12500]; dashboard: food actual_cents 12500, misc
    actual_cents 0 (−125 spend +125 netted → 0), total_expenses_cents 12500; budget mirrors.
    Plus: refund part on Salary → 422; both-parts-flagged NULL-inherit case (parent
    is_refund=true, parts unflagged → response shows true/true).
  - UPDATE tests asserting old wire keys: tests/test_splits.py `body["splits"]` name-set
    assertion still fine (keys unchanged); tests/test_manual_transactions.py pair-sum
    already moved in P1; test_refunds.py/test_transactions.py status-only — verify, adjust
    only if a money key remains.
  - UN-XFAIL: test_seam_transactions_list, test_seam_transactions_next_review,
    test_seam_transaction_create, test_seam_transaction_adjustment_pair,
    test_seam_transaction_patch; DELETE the now-unused XFAIL_REASON constant.
- [ ] Verify: pytest green, xfailed == 0. Commit `B2 P2:`.

### P3 — category-type change guard (S1)
- [ ] `backend/routers/categories.py`:
  - `CategoryPatch` gains `force: bool = False`.
  - Extract the delete_category census body into `_usage_counts(db, category_id) -> dict`
    (the four queries verbatim); `delete_category` calls it (single source, zero behaviour
    change).
  - `patch_category`: when `body.type is not None` and parses and
    `CategoryType(body.type) != cat.type`:
    ```python
    counts = _usage_counts(db, category_id)
    blockers = {label: n for label, n in counts.items() if n > 0}
    if blockers and not body.force:
        parts = ", ".join(f"{n} {label}(s)" for label, n in blockers.items())
        raise HTTPException(status_code=422, detail=(
            f"Cannot change type of '{cat.name}' to '{body.type}': "
            f"in use by {parts}. Reassign or remove them first, or pass force:true."))
    ```
    then assign. Name-only patches and same-type patches bypass the guard entirely
    (test_rename_only_name_leaves_type_unaffected must stay green unchanged). Invalid type →
    existing 422 BEFORE any census. Order matters: parse type first, then guard, then apply
    name/type mutations together (no partial commits — single commit as today).
  - No budget-row creation/removal on type change (decision 4).
- [ ] NEW `backend/tests/test_category_type_guard.py`:
  a. blocked: wants-category with a Rule → PATCH type needs → 422, detail mentions counts
     ("rule"); category type unchanged in DB.
  b. blocked: with a confirmed Transaction on it → 422 mentions "transaction".
  c. blocked: split-part reference → 422 mentions "split".
  d. blocked: StandingAdjustment pointing at it → 422 mentions "standing adjustment".
  e. force:true → 200, type changed, dependents untouched (rule still present).
  f. no dependents → type change succeeds WITHOUT force (fresh category flip works).
  g. rename-only on a heavily-used category → 200 (guard bypassed).
  h. invalid type string on used category → 422 (parse error, not census message).
- [ ] UN-XFAIL: test_category_type_guard in test_contract_seams.py.
- [ ] Verify: pytest green. Commit `B2 P3:`.

### P4 — full verification: suite, live boot probe, merge gate, push
- [ ] Full pytest from a clean env: `cd backend && python -m pytest -q` — report exact
      counts (expect ~185 passed, 0 failed, 0 xfailed).
- [ ] LIVE PROBE (real server, real HTTP — orchestrator runs independently too):
      `DATABASE_URL=sqlite:////tmp/b2-live/probe.db python -m uvicorn main:app --port 8011 &`
      then curl: `/health` → {"status":"ok"};
      POST /categories {name:"Probe Cat",type:"wants"} → capture id; POST /rules
      {pattern:"probe-cat-lock",category_id:<id>} ; PATCH /categories/<id>
      {"type":"needs"} → 422 with census detail; same +{"force":true} → 200;
      POST /transactions {date:"2026-08-20",amount_cents:-1234,description:"Probe buy",
      category_id:<wants cat id>} → 201 body.amount_cents == -1234 (int);
      GET /dashboard/summary?month=2026-08 → total_*_cents ints;
      GET /budget?month=2026-08 → rows carry planned_amount_cents/actual_amount_cents ints.
      Kill server; rm -rf /tmp/b2-live.
- [ ] Merge gate: `python3 ~/.hermes/fleet/merge-gate.py --repo /home/hermes/finance-tracker
      --no-seams` → verdict PASS (static owned-surface check must show only may_touch paths).
- [ ] Push: `git push` (SSH remote configured). Update THIS file's checkboxes as phases land.

## Verification record (fill during execution)
- Baseline: 167 passed, 10 xfailed @ f1f0a16 (orchestrator-verified pre-work).
- P1: — · P2: — · P3: — · P4: —

## Explicitly out of scope (report, don't build)
Sign-aware census refinement; budget-row maintenance on type flip; single-query trend;
F1-side anything; schemas.py/model edits of any kind.
