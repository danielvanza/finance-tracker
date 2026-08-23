# F1 P1 — design/schema brief (qrspi phase: 3_design + 4_structure, DESIGN ONLY)

You are a senior frontend architect. This is a DESIGN-ONLY round: produce one markdown
artifact and change NO source files. Output the artifact at
`thoughts/qrspi/t_750707e2/design.md` (create dirs as needed).

## Context

Repo `/home/hermes/finance-tracker` — personal finance tracker. FastAPI+SQLAlchemy backend,
React 19 + TS + Vite frontend (`frontend/src/`). Branch F1 of a re-platform DAG: flip all
frontend money handling to integer cents atomically.

Read first (all exist):
- `contracts/api-contracts.json` → `conventions.money_wire_format_v2` + `shared_envelope_shapes` (wire truth)
- `backend/schemas.py` (what B1 ACTUALLY shipped — ground truth; note it diverges from the
  contract's older "field names unchanged" prose)
- `contracts/schema.json#ts_mirror`
- `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/components/SplitEditor.tsx`
  (current state)

## B1 wire format (verified from backend/schemas.py — authoritative)

Responses serialize integer cents under `*_cents` names:
- `TransactionOut`: `amount_cents:int`, `splits[].amount_cents:int`, `splits[].is_refund:bool`
- `StandingAdjustmentOut`: `amount_cents:int>0`
- `BudgetRow`: `planned_amount_cents:int`, `actual_amount_cents:int|null`
- `DashboardSummary`: `total_income_cents`, `total_expenses_cents`, `total_savings_cents`,
  `left_over_cents`; nested dicts keep legacy keys: `category_breakdown[] {category_id,
  category_name, actual:int-cents, planned:int-cents, type}`, `income_breakdown[] {..., amount:
  int-cents}`, `needs_wants_savings {needs,wants,savings}` int-cents, `monthly_trend[]
  {month,total:int-cents}`
- Import preview rows: `amount_cents:int`

Requests accept BOTH: `*_cents` int OR legacy euro name with int treated as cents
(`_as_euros`: int→cents, float/str→euros). DECISION for F1: send `amount_cents` ints on
writes (createTransaction, patchTransaction splits, patchBudget, createAdjustmentPair legs,
standing-adjustment create/patch). Keep legacy field NAMES where the alias requires them
(e.g. SplitIn accepts `amount_cents` via alias) but always send cents ints.

## Deliverable — design.md containing

1. **money.ts API** — exact exported signatures + semantics. Must cover:
   - `formatCents(cents, opts?)` → "€1.234,56" Dutch locale (nl-NL), handles negatives
     (sign before €, matching current UI conventions like `-€34,99` / `+€5,00`)
   - `formatCentsPlain(cents)` → no symbol/tabular variants if needed by call sites
   - `parseToCents(input: string): number | null` — user input ("12,50", "12.50", "1250")
     → cents or null when not parseable; document rounding rule (HALF_UP to cent)
   - `centsToInputString(cents)` → canonical editable string ("1234" → "12.34") for inputs
   - split-math helpers operating in integer cents only (no floats anywhere)
   - Any percent/ratio helpers stay OUT unless trivially needed.
2. **types.ts v2** — full replacement interfaces mirroring ts_mirror + wire shapes above
   (renames to `_cents`, `SplitInput.amount_cents`, `TransactionSplit.is_refund: boolean`,
   `BudgetRow.category_type` note, etc).
3. **api.ts surface** — apiFetch wrapper design: signature, typed error class (ApiError with
   status + parsed detail string), behavior on non-OK (parse `{detail}`, fallback message),
   and how every existing api.* method maps onto it WITHOUT changing names/paths (the G
   contract test parses api.ts for `` `${BASE}...` `` template literals + `method:` lines —
   the wrapper must preserve that shape so `contract.test.ts` stays green UNCHANGED).
4. **Per-file change map** — every page/component file: each current euro-math site
   (toFixed/parseFloat/*100 etc.) → what replaces it (which money.ts fn). Include the
   non-money false positives that must NOT change: `(file.size/1024).toFixed(1)` KB in
   Import, ai_confidence*100 percents in ReviewCard/Transactions, pie-label percent math in
   Dashboard/Analytics/Budget ratios. Note Budget planned-edit input flow (currently edits
   raw number = euros; becomes centsToInputString/parseToCents), StandingAdjustments amount
   input flow, SummaryCards fmt(), recharts YAxis/tickFormatter + Tooltip formatters on
   Dashboard/Analytics (they format data values = cents now).
5. **Test plan** — money.test.ts unit cases (enumerate ~15 concrete cases incl. negatives,
   zero, rounding .005, comma input, thousands); fixture updates needed in existing tests
   (ReviewCard.test.tsx amounts -34.99→-3499 etc., SummaryCards.test.tsx expected strings);
   which tests must remain green UNCHANGED (contract.test.ts, Settings, CategoryManager,
   Import render tests) and why.

Constraints: no new runtime deps; no CSS/styling changes; no behaviour changes beyond unit
flip + is_refund surfacing; keep everything inside owned surfaces (types.ts/api.ts/money.ts/
pages/**/components/**/tests/**). Return the artifact path + a 10-line summary.
