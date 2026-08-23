# F1 P1 — design/schema brief (qrspi 3_design+4_structure, DESIGN ONLY)

You are a senior frontend architect. A prior exploration round already surveyed every
relevant file. Do NOT re-explore beyond spot-checks you genuinely need. Your FIRST action
must be creating `thoughts/qrspi/t_750707e2/design.md`, and your LAST action must be
verifying that file exists on disk (ls + wc -l) before you report done. DESIGN ONLY —
change zero source files.

## Repo / context

`/home/hermes/finance-tracker`. Branch F1 of the re-platform DAG: atomic frontend cents
flip. Prior exploration already confirmed:

- Wire truth = `backend/schemas.py` (B1 shipped): responses carry integer cents under
  `*_cents` names (`amount_cents`, `planned_amount_cents`, `actual_amount_cents`,
  `total_income_cents/expenses/savings/left_over_cents`). Dashboard nested dicts keep
  legacy keys but cents units: `category_breakdown[]{category_id,category_name,actual,planned,type}`,
  `income_breakdown[]{...,amount}`, `needs_wants_savings{needs,wants,savings}`,
  `monthly_trend[{month,total}]`. Import preview rows: `amount_cents`. Splits:
  `amount_cents` + `is_refund: bool`.
- Requests accept both spellings; F1 always SENDS `*_cents` ints.
- Two wire-truth caveats found by the prior round, document them in the design as
  accepted risks (B2 owns the fix, not F1): (a) some routers return plain dicts so
  Pydantic cent-serialisation is not yet wired everywhere — F1 types must mirror what the
  endpoints emit AFTER B2 lands (cents ints), which is the merge-order contract;
  (b) BudgetRow dict from routers lacks `category_type` today — keep `category_type:
  string` in the TS type as optional to survive both pre/post-B2 shapes.
- Current frontend euro-math sites (all must route through money.ts): ReviewCard.tsx
  (54,76,139), SplitModal.tsx (24,41,104), SplitEditor.tsx (21,32,43,132),
  AddTransactionModal.tsx (74,249,257), StandingAdjustments.tsx (59,77,131 input value),
  SummaryCards.tsx fmt() line 9 + income_breakdown subtext line 111,
  pages/Budget.tsx (155,267-268 totals,275 patchBudget euros,354 editing init,
  370 String(row.planned_amount),398,414,508,528,558,627,630),
  pages/Transactions.tsx (70,300,318), pages/Dashboard.tsx (100-103 ratio denominators ok,
  179/183/229/250/283/285 formatters), pages/Analytics.tsx (102,113 pct ratios ok,
  219 formatter, legend value line ~"€{item.value.toLocaleString}"),
  pages/Import.tsx (300 preview amount row).
- Non-money false positives that must NOT change: Import.tsx:174 `(file.size/1024).toFixed(1)`;
  ai_confidence*100 percents (ReviewCard 165, Transactions 364); pie percent labels +
  budget progress ratios (Dashboard 42,101-103; Analytics 53,102,113; Budget 270,296,532,639,652).
- api.ts contract-test constraint: `frontend/src/tests/contract.test.ts` parses api.ts
  source for `` `${BASE}...` `` template literals + `method: '<VERB>'` lines inside each
  `api.<name>` member. The apiFetch refactor MUST preserve that textual shape (wrapper
  takes the template string + method) or the G test breaks. It must stay green UNCHANGED.
- Tests that must stay green unchanged: contract.test.ts, Settings.test.tsx,
  CategoryManager.test.tsx, Import.test.tsx. Tests needing fixture updates:
  ReviewCard.test.tsx (amounts → cents ints, e.g. -34.99→-3499; split payload asserts
  become amount_cents), SummaryCards.test.tsx ('€5.860,26' expectation depends on new fmt
  of cents input 586026).

## Deliverable (single markdown file, sections below)

1. money.ts full API: exact exported signatures + semantics — formatCents (nl-NL €,
   negative sign placement `-€34,99`, positive `€1.234,56`; decide + document whether
   `+` prefix belongs here or at call sites given current UIs show explicit +/-),
   parseToCents (accept "12,50"/"12.50"/"1250"; HALF_UP to cent; null on garbage),
   centsToInputString (canonical editable "1234"→"12.34"), integer split-total/balance
   helpers. No floats anywhere.
2. types.ts v2: full replacement interface list mirroring the wire truth above
   (renames, SplitInput.amount_cents, TransactionSplit.is_refund, optional category_type).
3. api.ts: ApiError class + apiFetch signature and how each existing method maps onto it
   preserving the `${BASE}` template + `method:` literal shape; JSON body helpers; detail
   extraction from non-OK responses ({detail:string}, fallback text).
4. Per-file change map: table of every site listed above → replacement call; explicitly
   list the false positives as DO-NOT-TOUCH.
5. Test plan: enumerate ≥14 concrete money.test.ts cases (negatives, zero, rounding
   .005/.995, comma vs dot, empty, thousands, sign conventions); fixture updates for
   ReviewCard.test.tsx + SummaryCards.test.tsx; statement of which suites stay untouched.

Constraints: no new runtime deps; no styling changes; no behaviour change beyond the unit
flip and surfacing split-part is_refund; owned surfaces only. Return: artifact path +
line count + ≤10-line summary of key decisions.
