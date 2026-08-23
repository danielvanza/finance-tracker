# F1 R-D — Dashboard wire-shape render test (small, write-first)

Purpose: the integration smoke caught a bug class — nested dashboard keys drifted
(actual → actual_cents etc.) and tsc could NOT catch it at the SummaryCards boundary.
Add ONE regression test that renders Dashboard against the REAL wire shape.

Create exactly one file: `frontend/src/tests/Dashboard.test.tsx`. No other file changes.
No git commands, no agents. Write it, run it, fix until green.

## Test content

Mock `../api` (vi.mock) with `getDashboard` resolving a fixture that mirrors the LIVE
backend response byte-for-key (captured from the running v2 backend today):

```ts
const liveShape = {
  month: '2026-08',
  total_income_cents: 586026,
  total_expenses_cents: 342000,
  total_savings_cents: 40000,
  left_over_cents: 204026,
  category_breakdown: [
    { category_id: 13, category_name: 'Personal Allowance', actual_cents: 120000, planned_cents: 100000, type: 'wants' },
    { category_id: 1, category_name: 'Taxes & Mortgage', actual_cents: 222000, planned_cents: 200000, type: 'needs' },
  ],
  income_breakdown: [{ category_id: 18, category_name: 'Retained Salary', amount_cents: 586026 }],
  needs_wants_savings: { needs_cents: 222000, wants_cents: 120000, savings_cents: 0 },
  monthly_trend: [
    { month: '2026-06', total_cents: 0 }, { month: '2026-07', total_cents: 15000 },
    { month: '2026-08', total_cents: 342000 },
  ],
}
```

Also mock `getSettings` → Promise.resolve({ financial_month_start_day: '24' }).

Render `<Dashboard />` inside QueryClientProvider (retry: false). Assert:
1. `screen.getByText('€5.860,26')` present (income card, formatCents of total_income_cents).
2. `screen.getByText('€3.420,00')` present (spent card).
3. `screen.getByText('€2.040,26')` present (left-over card).
4. The needs legend row shows `€2.220,00` (formatCents of needs_cents — proves nested
   key consumed, would be NaN/undefined under the old key name).
5. `screen.getByText('Retained Salary')` present (income breakdown subtext).

Note: recharts ResponsiveContainer renders nothing measurable in jsdom but does not
crash; if the chart internals throw in jsdom, mock ResponsiveContainer minimally
(vi.mock('recharts', ...) partial with ResponsiveContainer: ({children}) => <div>) —
prefer NOT mocking unless a crash actually occurs.

## Verify

`cd frontend && npx vitest run src/tests/Dashboard.test.tsx 2>&1 | tail -5` — green.
Then full `npx vitest run 2>&1 | tail -4` — all green (50+ tests now).
Report real tails.
