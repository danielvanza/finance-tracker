# F1 P1 — Design & structure: atomic frontend cents flip

- **Ticket:** t_750707e2
- **Phase:** qrspi `3_design` + `4_structure` — **DESIGN ONLY. Zero source files changed in this phase.**
- **Repo:** `/home/hermes/finance-tracker` (branch F1 of the re-platform DAG)
- **Date:** 2026-08-23
- **Wire truth:** `backend/schemas.py` as shipped by B1 (integer cents under `*_cents` request/response names).
- Line numbers cited below come from the completed prior-exploration round; the implementer re-verifies each site as they touch it (cheap, expected, not re-exploration).

---

## 0. Scope, constraints, non-goals

**Owned surfaces (exhaustive):**

- New: `frontend/src/money.ts`, `frontend/src/tests/money.test.ts`
- Modified: `frontend/src/types.ts`, `frontend/src/api.ts`,
  `frontend/src/components/{ReviewCard,SplitModal,SplitEditor,AddTransactionModal,StandingAdjustments,SummaryCards}.tsx`,
  `frontend/src/pages/{Budget,Transactions,Dashboard,Analytics,Import}.tsx`,
  fixtures: `frontend/src/tests/ReviewCard.test.tsx`, `frontend/src/tests/SummaryCards.test.tsx`

**Hard constraints:**

1. No new runtime dependencies (hand-rolled money.ts; no dinero.js/currency.js).
2. No styling changes; only the *text* produced by formatters changes.
3. Behaviour delta limited to (i) euro-float → integer-cents unit flip, (ii) surfacing split-part `is_refund`.
4. `frontend/src/tests/contract.test.ts` parses `api.ts` source for a `` `${BASE}…` `` template literal and a `method: '<VERB>'` line **inside each `api.<name>` member**. The apiFetch refactor must keep those two textual anchors in every member. Contract suite stays green **unchanged**.
5. Suites that must stay green untouched: `contract.test.ts`, `Settings.test.tsx`, `CategoryManager.test.tsx`, `Import.test.tsx`.

**Non-goals:** any backend/router change (B2 owns router dict→Pydantic fixes), restyle, new features, touching percentages/ratios/file-size logic (see §4 DO-NOT-TOUCH).

---

## 1. `frontend/src/money.ts` — full API (new file)

Pure module: no imports, no DOM, deterministic. Every operation is integer-only. Floats are never constructed from user input — `parseToCents` works on digit **strings**, never `parseFloat`.

### 1.1 Exported signatures

```ts
/** Integer cents -> "€1.234,56" / "-€34,99" / "€0,00". Never emits '+'. */
export function formatCents(cents: number): string;

/** User-typed string -> integer cents, HALF_UP at the cent boundary; null on garbage. */
export function parseToCents(raw: string): number | null;

/** Canonical *editable* input value: 1234 -> "12.34", -3499 -> "-34.99", 0 -> "0.00". */
export function centsToInputString(cents: number): string;

/** Integer sum of cent amounts. */
export function sumCents(values: readonly number[]): number;

/** totalCents minus the sum of the parts' amount_cents (integer). */
export function splitRemainingCents(
  totalCents: number,
  parts: readonly { amount_cents: number }[]
): number;
```

### 1.2 `formatCents` semantics

- Input **must** be an integer; non-integers throw `TypeError` (deliberate dev tripwire so accidental float leakage fails loudly instead of silently mis-formatting).
- Output grammar: `['-'] '€' int-with-dot-grouping ',' dd`
  - `formatCents(123456)` → `"€1.234,56"`
  - `formatCents(-3499)` → `"-€34,99"` — minus sign sits **before** the `€`, no space anywhere
  - `formatCents(0)` → `"€0,00"`
  - `formatCents(586026)` → `"€5.860,26"` (parity anchor for the SummaryCards fixture)
- **Decision D1 — no `+` prefix.** Current UIs render explicit signs themselves in several places (transaction direction cues, split rows). `formatCents` therefore never emits `+`; a call site that wants a visible `+` composes it locally:
  `(cents > 0 ? '+' : '') + formatCents(cents)`. Keeping the formatter sign-policy fixed makes every display site predictable and keeps `formatCents(x) === formatCents(-x)` up to the leading `-`.

Why not `Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })`: it inserts a (narrow) no-break space after `€` (`"€ 1.234,56"`) and its negative placement/locale data varies across environments. We need byte-exact `"€1.234,56"` / `"-€34,99"` for tests and consistency. Hand-rolled, zero-dep:

```ts
const GROUP = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }); // integer grouping only
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new TypeError(`formatCents: non-integer ${cents}`);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const euros = (abs - (abs % 100)) / 100;   // integer div, no float
  const rem = String(abs % 100).padStart(2, '0');
  return (neg ? '-' : '') + '\u20AC' + GROUP.format(euros) + ',' + rem;
}
```

(The only `Intl` use is integer grouping, which is stable for `nl-NL`; if even that is deemed a risk, substitute a manual 3-digit-group loop — same output.)

### 1.3 `parseToCents` semantics

Accepted forms (after `trim()`):

| input        | result (cents) | rule                                   |
|--------------|----------------|----------------------------------------|
| `"12,50"`    | `1250`         | comma as decimal separator             |
| `"12.50"`    | `1250`         | dot as decimal separator               |
| `"1250"`     | `125000`       | **bare digits = whole euros**          |
| `"12,5"`     | `1250`         | single fractional digit pads to `,50`  |
| `"-34,99"`   | `-3499`        | leading `-`; result rounds away from 0 |
| `"+12,00"`   | `1200`         | leading `+` tolerated                  |
| `"0,005"`    | `1`            | HALF_UP at cent boundary               |
| `"0,004"`    | `0`            |                                        |
| `"0,995"`    | `100`          | HALF_UP carries into the euro          |
| `"-0,005"`   | `-1`           | symmetric (away from zero)             |

Rejected → `null`: `""`, `"   "`, `"abc"`, `"-"`, `"."`, `"12,3,4"`, `"1.234,56"` (two separators), trailing junk (`"12a"`).

- Grammar: `^[+-]?\d+([.,]\d*)?$` with **at most one** separator.
- **Decision D2 — bare digits are whole euros.** Matches mental model “I spent 1250” → `€1.250,00`; cent entry is always via `,`/`.`. Documented in the modal placeholder copy is *not* changed (out of scope), the helper’s doc comment carries the rule.
- **Decision D3 — HALF_UP via string arithmetic, never float.** Split on the separator; keep `intPart`, `frac2 = first two frac digits`, `rest = remaining frac digits`; `roundUp = rest >= '5'` (first char comparison suffices: any nonzero tail ≥ 5 means up only if first tail digit ≥ 5 — compare `Number(rest[0] ?? '0') >= 5`); assemble `intPart*100 + frac2 (+1 if roundUp, with carry into intPart)`; apply sign last. No `Number()` is ever called on a string containing a fractional value.
- Strictness limitation (accepted): paste-in of fully grouped strings like `"1.234,56"` returns `null`. Inputs are freshly typed in our modals; supporting grouped paste is a future enhancement, not F1 scope.

### 1.4 `centsToInputString` semantics

- Canonical **editable** representation for `<input>` values: always exactly 2 decimals, **no thousands grouping**, sign preserved: `1234→"12.34"`, `-3499→"-34.99"`, `0→"0.00"`, `123456→"1234.56"`.
- Round-trip property: for any canonical string `s`, `parseToCents(centsToInputString(parseToCents(s))) === parseToCents(s)`.
- Replaces every `String(row.planned_amount)` / `value={…euro…}` controlled-input site (Budget.tsx:370, StandingAdjustments.tsx:131, SplitEditor.tsx init).

### 1.5 Split helpers

- `sumCents([...])` — trivial integer reduce; used for split totals.
- `splitRemainingCents(totalCents, parts)` = `totalCents - sumCents(parts.map(p => p.amount_cents))`. Save buttons gate on `splitRemainingCents(total, parts) === 0`; the “remaining” chip renders `formatCents(splitRemainingCents(...))` (with local `+/-` composition where the UI shows direction).
- Both are total functions over integers — no epsilon comparisons anywhere (float-era `Math.abs(x) < 0.005` guards die with the float).

---

## 2. `frontend/src/types.ts` v2 — replacement interface list

Rename table (everything not listed stays byte-identical to current `types.ts`; names verified against the file):

| today                              | v2                                    |
|------------------------------------|---------------------------------------|
| `Transaction.amount`               | `Transaction.amount_cents`            |
| `TransactionSplit.amount`          | `.amount_cents` (+ adds `is_refund: boolean`) |
| `SplitInput.amount`                | `.amount_cents` (+ adds `is_refund: boolean`) |
| `StandingAdjustment.amount`        | `.amount_cents`                       |
| `BudgetRow.planned_amount` / `.actual_amount` | `planned_amount_cents` / `actual_amount_cents` |
| `DashboardSummary.total_income/total_expenses/total_savings/left_over` | `*_cents` |
| import preview row `amount`        | `amount_cents`                        |

Unions (new, tightened from bare `string`): `CategoryType = 'needs' | 'wants' | 'savings'`, `TransactionSource = 'ing' | 'revolut' | 'degiro'`, `CategorisedBy = 'rule' | 'ai' | 'manual'`.

```ts
export interface Category {
  id: number;
  name: string;
  type: CategoryType;      // tightened from string
  sort_order: number;      // kept
}

export interface TransactionSplit {
  id: number;
  category_id: number | null;
  category_name: string | null;
  amount_cents: number;    // RENAMED, was `amount`
  is_refund: boolean;      // NEW on the wire
}

export interface Transaction {
  id: number;
  date: string;
  description: string;
  amount_cents: number;    // RENAMED, was `amount`
  source: TransactionSource;
  category_id: number | null;
  category_name: string | null;
  confirmed: boolean;
  categorised_by: CategorisedBy | null;
  ai_confidence: number | null;         // unchanged, percent domain
  is_refund: boolean;                   // unchanged (transaction-level)
  standing_adjustment_id: number | null;
  splits: TransactionSplit[];
}

export interface SplitInput {
  category_id: number;     // required, unchanged
  amount_cents: number;    // RENAMED, was `amount`
  is_refund: boolean;      // NEW on the wire; UI constructs default false
}

export interface StandingAdjustment {
  id: number;
  name: string;
  amount_cents: number;    // RENAMED, was `amount`
  income_category_id: number;
  expense_category_id: number;
  active: boolean;
  start_month: string;
}

export interface BudgetRow {
  id: number;
  category_id: number;
  category_name: string;
  category_type?: CategoryType;      // OPTIONAL — see Risk R2 (routers omit it pre-B2)
  month: string | null;
  planned_amount_cents: number;      // RENAMED
  actual_amount_cents: number | null; // RENAMED, nullability kept
}

// Interface name unchanged: DashboardSummary (NOT DashboardData)
export interface DashboardSummary {
  month: string;
  total_income_cents: number;
  total_expenses_cents: number;
  total_savings_cents: number;
  left_over_cents: number;
  // Legacy KEYS kept by B1, VALUES are integer cents:
  category_breakdown: Array<{
    category_id: number;
    category_name: string;
    actual: number;   // cents (legacy key name retained)
    planned: number;  // cents (legacy key name retained)
    type: CategoryType;
  }>;
  needs_wants_savings: { needs: number; wants: number; savings: number }; // cents
  monthly_trend: Array<{ month: string; total: number }>;                  // total = cents
  income_breakdown: Array<{
    category_id: number;
    category_name: string;
    amount: number;   // cents (legacy key name retained)
  }>;
}

export interface SettingsMap { [key: string]: string }  // unchanged

export interface ImportPreviewRow {   // shaped at the preview endpoint; mirrors schema
  /* …unchanged date/description/category fields… */
  amount_cents: number;               // RENAMED, was `amount`
}
```

Request-payload renames (in `api.ts`, typed at each member): `createTransaction` body `{ amount }` → `{ amount_cents }`; `createAdjustmentPair` legs `{ amount }` → `{ amount_cents }`; `patchBudget(id, planned_amount)` signature becomes `patchBudget(id, planned_amount_cents)` sending `{ planned_amount_cents }`; standing-adjustment create/patch bodies follow `amount_cents`.

Notes:

- **Legacy nested keys are deliberately NOT renamed** (`actual`, `planned`, `amount`, `total`, `needs/wants/savings`). Only the *unit* changed. Renaming them is B-scope work, not F1; the doc-comment on `DashboardSummary` states “values are integer cents despite legacy key names.”
- `Rule` and all rule-router types are money-free → untouched.
- Any interface not reproduced above keeps its current shape; its money fields, if any, follow the same `_cents` rename rule and are checked against `schemas.py` during implementation.

---

## 3. `frontend/src/api.ts` — `ApiError` + `apiFetch`

### 3.1 `ApiError`

```ts
export class ApiError extends Error {
  readonly status: number;      // HTTP status, or 0 for network failure
  readonly detail: string | null;
  constructor(status: number, message: string, detail: string | null) { … }
}
```

Detail extraction on non-OK responses, in order:

1. Parse body as JSON; if it yields an object with a string `detail` → `detail` = that string, `message` = same.
2. Else `detail = null`, `message = res.statusText || \`Request failed (${res.status})\``.
3. Body-parse failures fall through to (2) silently.
4. `fetch` rejection (network/DNS) is wrapped as `new ApiError(0, 'Network error', null)` so callers handle exactly one error type.

### 3.2 `apiFetch` signature

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function apiFetch<T>(
  pathTemplate: string,
  opts: { method?: HttpMethod; body?: unknown } = {}
): Promise<T>
```

Wrapper responsibilities: prefix nothing (callers pass full `` `${BASE}…` ``), `JSON.stringify(opts.body)` + `Content-Type: application/json` when `body !== undefined`, unwrap JSON success as `T`, raise `ApiError` otherwise.

**FormData carve-out:** `api.previewImport` / `api.confirmImport` send `multipart/form-data` today and must keep doing so. Rule: when `body instanceof FormData`, the wrapper passes it straight through — no `JSON.stringify`, no `Content-Type` header (browser sets the multipart boundary). All other bodies are JSON-encoded.

### 3.3 Contract-test preservation — the core rule

Every exported member keeps **both textual anchors inline**, exactly as today:

```ts
export const api = {
  getBudget: (month: string): Promise<BudgetRow[]> =>
    apiFetch<BudgetRow[]>(
      `${BASE}/budget?month=${month}`,           // ← anchor 1: `${BASE}` template literal stays HERE
      { method: 'GET' }                           // ← anchor 2: `method: '<VERB>'` line stays HERE
    ),

  createTransaction: (body: TransactionCreateBody): Promise<Transaction> =>
    apiFetch<Transaction>(
      `${BASE}/transactions`,
      { method: 'POST', body }                    // body carries amount_cents per §2
    ),

  deleteTransaction: (id: number): Promise<unknown> =>
    apiFetch(
      `${BASE}/transactions/${id}`,
      { method: 'DELETE' }
    ),
};
```

Consequences (binding, verified against `contract.test.ts:40–66`):

- The parser slices each member between `/^ {2}([A-Za-z_$][\w$]*):/m` anchors inside `` export const api = { `` and requires per block: one `` /`(\$\{BASE\}[^`]*)`/ `` template literal and one `` /method:\s*'(GET|POST|PATCH|DELETE|PUT)'/ ``. Therefore: members stay 2-space-indented keys of the same object literal; every member keeps exactly that template literal and a literal `method: '<VERB>'` line.
- **No `params` option.** Query strings stay embedded in the template literal. The two existing query-builder idioms — `getTransactions`'s `` `${BASE}/transactions${q ? '?' + q : ''}` `` and `getNextReview`'s hand-built params string — are *explicitly normalised* by the test (lines 29–34) and must be preserved **verbatim**, interpolation text included.
- Method verbs are written literally at each member (`method: 'GET'`), never computed/aliased.
- Bodies become plain objects (`body: payload`) or `FormData` passthroughs — `JSON.stringify` and header boilerplate move into the wrapper; members lose their private fetch plumbing but keep both anchors visible.
- Mechanical mapping for every existing member (all 22 of them, names unchanged): `<verb> \`${BASE}/path…\`` + optional body → `apiFetch(\`${BASE}/path…\`, { method: '<VERB>'[, body: payload] })`. No member changes URL shape, verb, or response type. Worked examples using real members:

```ts
getDashboard: (month: string): Promise<DashboardSummary> =>
  apiFetch(`${BASE}/dashboard/summary?month=${month}`, { method: 'GET' }),

patchTransaction: (id: number, body: …): Promise<Transaction> =>
  apiFetch(`${BASE}/transactions/${id}`, {
    method: 'PATCH', body,
  }),

previewImport: (source: string, file: File): Promise<ImportPreview[]> => {
  const fd = new FormData(); fd.append('source', source); fd.append('file', file);
  return apiFetch(`${BASE}/import/preview`, { method: 'POST', body: fd });
},
```

All request payloads in members that send money (`createTransaction`, `createAdjustmentPair` legs, `patchBudget`, standing-adjustment create/patch) switch to `*_cents` integer fields per §2.

---

## 4. Per-file change map

Legend: **F** = `formatCents`, **P** = `parseToCents`, **CIS** = `centsToInputString`.

### components/ReviewCard.tsx

| line | today                          | becomes                                             |
|------|--------------------------------|-----------------------------------------------------|
| 54   | `fmt(t.amount)`                | `F(t.amount_cents)`                                 |
| 76   | euro render (split total/context) | `F(…_cents)`                                     |
| 139  | split-row amount               | `(s.is_refund ? '+' : '') + F(s.amount_cents)` — **the deliberate is_refund surfacing** |
| 165  | `ai_confidence*100`            | DO NOT TOUCH                                        |

### components/SplitModal.tsx

| line | today                        | becomes                                              |
|------|------------------------------|------------------------------------------------------|
| 24   | float sum of parts           | `sumCents(parts.map(p => p.amount_cents))`           |
| 41   | remaining calc               | `splitRemainingCents(totalCents, parts)`; render `F(...)`; save gated on `=== 0` |
| 104  | payload build                | `{ amount_cents: p.amount_cents, is_refund: p.is_refund }` |

### components/SplitEditor.tsx

| line | today                       | becomes                                               |
|------|-----------------------------|-------------------------------------------------------|
| 21   | initial input value (euros) | `CIS(part.amount_cents)`                              |
| 32   | onChange store              | store `P(text) ?? previous` (null ⇒ keep last valid, clear-on-invalid stays UI-local) |
| 43   | validation                  | integer compare via `splitRemainingCents`             |
| 132  | display                     | `F(...)`                                              |

### components/AddTransactionModal.tsx

| line | today                      | becomes                                                |
|------|----------------------------|--------------------------------------------------------|
| 74   | amount state/display       | keep raw text in state; display via `F(P(text) ?? 0)` only where a formatted echo exists |
| 249  | submit payload             | `amount_cents: P(amountText)!` (submit disabled unless non-null) |
| 257  | split payload              | `amount_cents: P(part.text)!`, `is_refund: part.is_refund ?? false` |

### components/StandingAdjustments.tsx

| line | today                       | becomes                                                |
|------|-----------------------------|--------------------------------------------------------|
| 59   | amount display              | `F(x.amount_cents)`                                    |
| 77   | submit                      | send `amount_cents: P(text)!`                          |
| 131  | controlled input value      | `value={CIS(x.amount_cents)}`                          |

### components/SummaryCards.tsx

| line | today                       | becomes                                                 |
|------|-----------------------------|---------------------------------------------------------|
| 9    | `fmt()` definition          | deleted; all uses call `F` (`formatCents`) directly     |
| 111  | income_breakdown subtext    | `F(item.amount)` (item.amount is cents, legacy key kept)|

### pages/Budget.tsx

| line      | today                                  | becomes                                            |
|-----------|----------------------------------------|----------------------------------------------------|
| 155       | header/summary euro render             | `F(..._cents)`                                     |
| 267–268   | totals row                             | `F(sum)` where sums come from `sumCents` over row cents |
| 275       | `patchBudget({ planned_amount: euros })` | `patchBudget({ planned_amount_cents: P(editText)! })` |
| 354       | editing init                           | `setEditText(CIS(row.planned_amount_cents))`       |
| 370       | `String(row.planned_amount)`           | `CIS(row.planned_amount_cents)`                    |
| 398, 414  | cell renders                           | `F(row.actual_amount_cents)` / `F(row.planned_amount_cents)` (match which is which at edit time) |
| 508, 528, 558 | renders/derived strings            | `F(...)` over the corresponding `*_cents` field    |
| 627, 630  | footer/legend renders                  | `F(...)`                                           |

### pages/Transactions.tsx

| line | today            | becomes                                                      |
|------|------------------|--------------------------------------------------------------|
| 70   | amount cell      | `F(t.amount_cents)`                                          |
| 300  | render           | `F(...)`                                                     |
| 318  | render           | `F(...)`                                                     |
| 364  | ai_confidence%   | DO NOT TOUCH                                                 |

### pages/Dashboard.tsx

| line     | today                              | becomes                                           |
|----------|------------------------------------|---------------------------------------------------|
| 100–103  | ratio denominators                 | DO NOT TOUCH (counts/ratios, unit-free)           |
| 179, 183 | chart axis/tooltip formatters      | formatter bodies delegate to `F`                  |
| 229      | tooltip/label formatter            | `F(v)`                                            |
| 250      | breakdown render                   | `F(item.actual)` (legacy key, cents value)        |
| 283, 285 | trend/total renders                | `F(pt.total)` / `F(..._cents)`                    |
| 42       | pie percent label                  | DO NOT TOUCH                                      |

### pages/Analytics.tsx

| line | today                                    | becomes                                    |
|------|------------------------------------------|--------------------------------------------|
| 102, 113 | pct ratios                           | DO NOT TOUCH                               |
| 219  | tooltip/axis formatter                   | delegate to `F`                            |
| ~219 | legend `` `€${item.value.toLocaleString()}` `` | `F(item.value)` (value now cents; drop `toLocaleString`) |
| 53   | pie percent                              | DO NOT TOUCH                               |

### pages/Import.tsx

| line | today                 | becomes                                |
|------|-----------------------|----------------------------------------|
| 300  | preview amount cell   | `F(row.amount_cents)`                  |
| 174  | `(file.size/1024).toFixed(1)` | DO NOT TOUCH                   |

### DO-NOT-TOUCH (explicit false positives)

- `Import.tsx:174` — file size KB formatting.
- AI-confidence percentages: `ReviewCard.tsx:165`, `Transactions.tsx:364`.
- Pie-percent labels & budget-progress ratios: `Dashboard.tsx:42,101–103`; `Analytics.tsx:53,102,113`; `Budget.tsx:270,296,532,639,652`.

---

## 5. Test plan

### 5.1 New: `frontend/src/tests/money.test.ts` (≥14 cases, all exact-equality)

1. `formatCents(0)` → `'€0,00'`
2. `formatCents(123456)` → `'€1.234,56'` (dot grouping, comma decimals)
3. `formatCents(-3499)` → `'-€34,99'` (sign before symbol, no space)
4. `formatCents(5)` → `'€0,05'`; `formatCents(99)` → `'€0,99'` (sub-euro)
5. `formatCents(-5)` → `'-€0,05'` (small negative keeps placement)
6. `formatCents(3499)` → `'€34,99'` — **no `+` ever** (D1)
7. `formatCents(586026)` → `'€5.860,26'` (SummaryCards fixture parity)
8. `expect(() => formatCents(12.5)).toThrow(TypeError)` (integer tripwire)
9. `parseToCents('12,50')` → `1250`; `parseToCents('12.50')` → `1250` (separator equivalence)
10. `parseToCents('1250')` → `125000` (bare = whole euros, D2)
11. `parseToCents('-34,99')` → `-3499`; `parseToCents('+12,00')` → `1200` (signs)
12. `parseToCents('0,005')` → `1` and `parseToCents('0,004')` → `0` (HALF_UP boundary)
13. `parseToCents('-0,005')` → `-1` and `parseToCents('0,995')` → `100` (symmetry + euro carry)
14. `parseToCents('12,5')` → `1250` (single frac digit pads)
15. `parseToCents` garbage → `null` for `''`, `'  '`, `'abc'`, `'-'`, `'.'`, `'12,3,4'`, `'1.234,56'`, `'12a'`
16. `centsToInputString`: `1234→'12.34'`, `0→'0.00'`, `-3499→'-34.99'`, `123456→'1234.56'` (editable form: no grouping, always 2 dp)
17. Round-trip: for `['12.34','-34.99','0.00','1234.56']`, `parseToCents(CIS(parseToCents(s))) === parseToCents(s)`
18. `splitRemainingCents(1000, [{amount_cents:400},{amount_cents:600}])` → `0`; `splitRemainingCents(-3499, [{amount_cents:-3000}])` → `-499` (negative totals exact, no epsilon)
19. `sumCents([])` → `0`; `sumCents([-5, 5])` → `0`

### 5.2 Fixture updates

- **`ReviewCard.test.tsx`**: all monetary props become cent ints (`-34.99 → -3499`); expected rendered strings stay `'-€34,99'` (formatter output unchanged in shape); split-save payload assertions rename `amount` → `amount_cents` and add `is_refund` expectation; split-row render assertion gains the `+` prefix case for `is_refund: true`.
- **`SummaryCards.test.tsx`**: income-breakdown fixture value becomes `586026` (cents) and the expected subtext stays `'€5.860,26'` — validates the new formatter end-to-end through the component.

### 5.3 Untouched suites (must pass with zero edits)

`contract.test.ts` (validates §3 anchor preservation), `Settings.test.tsx`, `CategoryManager.test.tsx`, `Import.test.tsx`.

### 5.4 Verification commands

```bash
cd frontend && npx vitest run          # full suite green
cd frontend && npx tsc --noEmit        # types compile clean
cd backend && pytest                   # backend untouched; sanity only
```

---

## 6. Accepted risks (documented, owned outside F1)

- **R1 — merge-order contract.** Some routers return plain dicts, so Pydantic cent serialisation isn’t wired everywhere yet. F1’s TS types intentionally mirror the **post-B2** emission (integer cents everywhere). F1 merges only after B2; until then intermediate states may show floats under legacy keys. F1 changes no router.
- **R2 — `BudgetRow.category_type`.** Routers omit it today; kept `optional` in TS so both pre-/post-B2 shapes typecheck. Call sites must not rely on it being present (no non-null assertions).
- **R3 — `parseToCents` strictness.** Grouped paste-ins (`"1.234,56"`) are rejected (`null`). Accepted: inputs are freshly typed in modals; revisit if users complain.
- **R4 — legacy nested key names.** `DashboardData` keeps keys `actual/planned/amount/total/needs/wants/savings` with cents *values*. Risk of future readers assuming euros is mitigated by doc-comments only; renaming is explicitly out of scope.

## 7. Key decisions index

- **D1** `formatCents` never emits `+`; sign composition at call sites.
- **D2** bare digit input = whole euros (`"1250"` → €1.250,00).
- **D3** HALF_UP rounding via string arithmetic; zero float construction.
- **D4** hand-rolled nl-NL formatter (byte-exact output, no Intl-currency spacing variance).
- **D5** `apiFetch(path, { method, body })` with anchors kept inline per member; no `params` option — query strings stay in the `` `${BASE}` `` template literal.
