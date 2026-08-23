import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from '../pages/Dashboard'

// Fixture mirrors the LIVE backend response byte-for-key (captured from the
// running v2 backend). Nested keys use the *_cents wire names — this test is
// the regression guard against key drift at the Dashboard boundary.
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

vi.mock('../api', () => ({
  api: {
    getDashboard: vi.fn(() => Promise.resolve(liveShape)),
    getSettings: vi.fn(() => Promise.resolve({ financial_month_start_day: '24' })),
  },
}))

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>)
}

describe('Dashboard against real wire shape', () => {
  it('renders summary cards, nested legend values and income breakdown', async () => {
    renderDashboard()

    // Summary cards (top-level *_cents keys)
    expect(await screen.findByText('€5.860,26')).toBeInTheDocument() // total_income_cents
    expect(screen.getByText('€3.420,00')).toBeInTheDocument()        // total_expenses_cents
    expect(screen.getByText('€2.040,26')).toBeInTheDocument()        // left_over_cents

    // Needs legend row — proves nested needs_wants_savings.needs_cents is
    // consumed correctly (NaN/undefined under drifted legacy key names)
    expect(screen.getByText('€2.220,00')).toBeInTheDocument()

    // Income breakdown subtext
    expect(screen.getByText(/Retained Salary/)).toBeInTheDocument()
  })
})
