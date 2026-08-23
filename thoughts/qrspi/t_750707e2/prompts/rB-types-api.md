# F1 R-B — rewrite types.ts + api.ts (write FIRST, minimal reads)

Context: `frontend/src/money.ts` already landed (integer-cents helpers). This round
rewrites the type + transport foundation so the whole app is typed against integer
cents. Allowed files: `frontend/src/types.ts`, `frontend/src/api.ts`. Do NOT touch
pages/components/tests this round; do NOT run agents; no git commands.

You may re-read: current types.ts, api.ts, backend/schemas.py, contracts/
api-contracts.json (only if needed for a field check). Then WRITE immediately.

## types.ts — full replacement

```ts
export type CategoryType = 'needs' | 'wants' | 'savings' | 'income' | 'exclude'
export type TransactionSource = 'ing' | 'revolut' | 'degiro' | 'manual'
export type CategorisedBy = 'rule' | 'ai' | 'manual'

export interface TransactionSplit {
  id: number
  category_id: number | null
  category_name: string | null
  amount_cents: number      // renamed from `amount`; integer cents
  is_refund: boolean        // v2: per-part refund flag (NULL-inherit resolved server-side)
}

export interface Transaction {
  id: number
  date: string
  description: string
  amount_cents: number      // renamed from `amount`
  source: TransactionSource
  category_id: number | null
  category_name: string | null
  confirmed: boolean
  categorised_by: CategorisedBy | null
  ai_confidence: number | null
  is_refund: boolean
  standing_adjustment_id: number | null
  splits: TransactionSplit[]
}

// Request payload for split parts — NO per-part refund on input (wire has none).
export interface SplitInput {
  category_id: number
  amount_cents: number
}

export interface StandingAdjustment {
  id: number
  name: string
  amount_cents: number     // renamed from `amount`; positive cents
  income_category_id: number
  expense_category_id: number
  active: boolean
  start_month: string
}

export interface Category {
  id: number
  name: string
  type: CategoryType
  sort_order: number
}

export interface BudgetRow {
  id: number
  category_id: number
  category_name: string
  category_type?: CategoryType   // OPTIONAL: routers omit it pre-B2
  month: string | null
  planned_amount_cents: number       // renamed from planned_amount
  actual_amount_cents: number | null // renamed from actual_amount
}

export interface Rule { id: number; pattern: string; category_id: number; category_name: string; priority: number }

// NOTE: nested keys keep their LEGACY names by wire contract; the VALUES are
// integer cents since B1 (see contracts api-contracts money_wire_format_v2).
export interface DashboardSummary {
  month: string
  total_income_cents: number
  total_expenses_cents: number
  total_savings_cents: number
  left_over_cents: number
  category_breakdown: Array<{
    category_id: number
    category_name: string
    actual: number    // legacy key, integer cents value
    planned: number   // legacy key, integer cents value
    type: CategoryType
  }>
  needs_wants_savings: { needs: number; wants: number; savings: number }  // cents
  monthly_trend: Array<{ month: string; total: number }>                  // total = cents
  income_breakdown: Array<{
    category_id: number
    category_name: string
    amount: number    // legacy key, integer cents value
  }>
}

export interface SettingsMap { [key: string]: string }

export interface ImportPreviewRow {
  date: string
  amount_cents: number
  description: string
  source: string
  import_hash: string
  duplicate: boolean
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[]
  total: number
  duplicates: number
}

export interface ImportConfirmResponse {
  imported: number
  skipped_duplicates: number
  categorised_by_rule: number
  categorised_by_ai: number
  uncategorised: number
}
```

## api.ts — full replacement

Shape rules (the G contract test parses these textually — breaking them fails CI):
- keep `const BASE = '/api'` and `export const api = {` with every member a 2-space
  key of that object; each member keeps its `` `${BASE}...` `` template literal inline
  AND a literal `method: '<VERB>'` line; getTransactions/getNextReview query idioms
  stay verbatim (`${q ? '?' + q : ''}` etc).
- Add ABOVE the api object:

```ts
export class ApiError extends Error {
  readonly status: number      // HTTP status; 0 = network failure
  readonly detail: string | null
  constructor(status: number, message: string, detail: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function apiFetch<T>(pathTemplate: string, opts: { method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown } = {}): Promise<T> {
  try {
    const init: RequestInit = { method: opts.method ?? 'GET' }
    if (opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        init.body = opts.body                      // browser sets multipart boundary
      } else {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(opts.body)
      }
    }
    const res = await fetch(pathTemplate, init)
    if (!res.ok) {
      let detail: string | null = null
      try {
        const data = await res.json()
        if (data && typeof data.detail === 'string') detail = data.detail
      } catch { /* non-JSON body */ }
      throw new ApiError(res.status, detail ?? res.statusText || `Request failed (${res.status})`, detail)
    }
    return res.json() as Promise<T>
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'Network error', null)
  }
}
```

- Every member becomes e.g.
  `getBudget: (month: string): Promise<import('./types').BudgetRow[]> => apiFetch(`${BASE}/budget?month=${month}`, { method: 'GET' }),`
  Keep using `import('./types').X` style annotations like today. Preserve ALL member
  names and URL shapes exactly as in the current file. Members sending FormData
  (previewImport/confirmImport) build fd then `apiFetch(...{ method: 'POST', body: fd })`,
  typed Promise<import('./types').ImportPreviewResponse / ImportConfirmResponse>.
- Money-bearing request payloads rename to *_cents ints:
  - createTransaction body `{ date: string; amount_cents: number; description: string; category_id: number; is_refund?: boolean }`
  - createAdjustmentPair legs `Array<{ amount_cents: number; category_id: number; description?: string }>`
  - patchTransaction keeps `(id, body)` shape; splits typed `import('./types').SplitInput[]`
  - patchBudget: `(id: number, planned_amount_cents: number)` sending `{ planned_amount_cents }`
  - createStandingAdjustment/patchStandingAdjustment bodies use `amount_cents`
- Response-typed members keep/gain precise types from './types' (getDashboard:
  DashboardSummary; getTransactions: Transaction[]; getNextReview: Transaction | null;
  getStandingAdjustments: StandingAdjustment[]; getCategories: Category[];
  getRules: Rule[]; getSettings: SettingsMap). Untyped today -> give them types.

## Verify

1. `cd frontend && npx tsc -b 2>&1 | tail -20` — EXPECT errors ONLY inside pages/,
   components/, tests/ReviewCard.test.tsx, tests/SummaryCards.test.tsx caused by the
   renames (those get fixed next round). ZERO errors inside types.ts/api.ts themselves.
2. `cd frontend && npx vitest run src/tests/contract.test.ts src/tests/money.test.ts src/tests/Settings.test.tsx src/tests/CategoryManager.test.tsx src/tests/Import.test.tsx 2>&1 | tail -8`
   EXPECT all green EXCEPT possibly Settings.test.tsx IF it mocks api members whose
   signatures changed — do NOT edit test files; report status honestly.
Report: tsc error list summary (file:count), vitest pass/fail counts.
