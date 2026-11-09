import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Month from '../pages/Month'
import Categories from '../pages/month/Categories'
import { api } from '../api'
import type { BudgetRow, Pace } from '../types'

const spentPerDay = [99.35, 0, 1868.14, 92.5, 212.64, 14.69, 32.37, 40.64, 1217.99, 31.3, 109.67, 82.75, 0, 67.63, 57.86, 35.68]
let sum = 0
const daily = spentPerDay.map((a, i) => ({ date: `2026-10-${24 + i}`, cumulative_cents: (sum += Math.round(a * 100)) }))

const pace = (over: Partial<Pace> = {}): Pace => ({
  month: '2026-11', current_month: '2026-11', status: 'ok',
  start_date: '2026-10-24', end_date: '2026-11-23', today: '2026-11-09',
  days_total: 31, day_number: 17, days_left: 14,
  plan_cents: { needs: 325000, wants: 210000, savings: 40000 },
  actual_cents: { needs: 237800, wants: 158500, savings: 30000 },
  spendable_plan_cents: 535000, spendable_actual_cents: daily[daily.length - 1].cumulative_cents,
  pace_delta_cents: 120200, daily, data_through: '2026-11-08',
  last_import_by_bank: [{ source: 'ing', last_date: '2026-11-08' }], behind_months: [], to_review: 0, ...over,
})

vi.mock('../api', () => ({
  api: {
    getPace: vi.fn(),
    getBudget: vi.fn(() => Promise.resolve([])),
    getCategories: vi.fn(() => Promise.resolve([])),
    getTransactions: vi.fn(() => Promise.resolve([])),
    getDashboard: vi.fn(() => Promise.resolve({
      month: '2026-11', total_income_cents: 0, total_expenses_cents: 0, total_savings_cents: 0,
      left_over_cents: 0, category_breakdown: [], income_breakdown: [],
      needs_wants_savings: { needs_cents: 0, wants_cents: 0, savings_cents: 0 }, monthly_trend: [],
    })),
    patchBudget: vi.fn(() => Promise.resolve({})),
  },
  // The recurring link asks for its own data; nothing repeating yet keeps it hidden.
  BASE: '/api',
  apiFetch: vi.fn(() => Promise.resolve({ status: 'none', items: [] })),
  ApiError: class extends Error {},
}))

const wrap = (ui: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => (
  <QueryClientProvider client={client}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

describe('Month verdict sentence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('compares the daily allowance with ordinary days and says where the month ends', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace())
    render(wrap(<Month />))
    expect(await screen.findByText(/About €\d+ a day keeps you in plan; ordinary days have cost about €\d+\. At this pace you will finish about €\d+ (over|under)\./)).toBeInTheDocument()
    expect(screen.queryByText(/than planned by now/)).toBeNull()
  })

  it('keeps the plain sentence for an earlier month', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ day_number: null, days_left: null }))
    render(wrap(<Month />))
    expect(await screen.findByText(/spent of €5\.350 planned\./)).toBeInTheDocument()
    expect(screen.queryByText(/At this pace/)).toBeNull()
  })
})

describe('Month while another month loads', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the bar, buttons and the month on screen, dimmed, until the next arrives', async () => {
    const user = userEvent.setup()
    let release: (p: Pace) => void = () => {}
    vi.mocked(api.getPace).mockImplementation(month => month
      ? new Promise<Pace>(resolve => { release = resolve })
      : Promise.resolve(pace()))
    const { container } = render(wrap(<Month />))
    const heading = await screen.findByRole('heading', { level: 1 })
    const before = heading.textContent

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(before)
    const body = container.querySelector('.month-body')!
    expect(body).toHaveClass('is-loading')
    expect(body).toHaveAttribute('aria-busy', 'true')

    release(pace({ month: '2026-10', day_number: null, days_left: null, start_date: '2026-09-24', end_date: '2026-10-23', spendable_actual_cents: 313100 }))
    await waitFor(() => expect(container.querySelector('.month-body')).not.toHaveClass('is-loading'))
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('goes back from the month being asked for when tapped again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPace).mockImplementation(month => month ? new Promise<Pace>(() => {}) : Promise.resolve(pace()))
    render(wrap(<Month />))
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(api.getPace).toHaveBeenLastCalledWith('2026-09')
  })
})

describe('Categories', () => {
  const row = (id: number, name: string, actual: number, planned: number, type: BudgetRow['category_type'] = 'needs'): BudgetRow => ({
    id, category_id: id, category_name: name, category_type: type, month: '2026-11',
    planned_amount_cents: planned, actual_amount_cents: actual,
  })
  const base = [
    row(1, 'Taxes', 185000, 200000), row(2, 'Food', 22500, 35000), row(3, 'Utilities', 9300, 20000),
    row(4, 'Transportation', 6800, 20000), row(5, 'Insurance', 13400, 40000),
  ]
  const props = { month: '2026-11', categories: [], todayPct: 50, payments: null, elapsed: null, onError: () => {} }

  it('keeps the open row where it is when its plan changes, and sorts when it closes', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(wrap(<Categories rows={base} {...props} />, client))
    await user.click(screen.getByRole('button', { name: /Transportation/ }))
    const order = () => screen.getAllByRole('button').filter(b => b.classList.contains('cat-row')).map(b => b.querySelector('.cat-name')?.textContent)
    const opening = order()
    expect(opening).toEqual(['Taxes', 'Food', 'Utilities', 'Transportation', 'Insurance'])

    // Transportation is now 68 of 60: furthest through its plan, but it stays put while open.
    const changed = base.map(r => (r.category_id === 4 ? { ...r, planned_amount_cents: 6000 } : r))
    rerender(wrap(<Categories rows={changed} {...props} />, client))
    expect(order()).toEqual(opening)

    await user.click(screen.getByRole('button', { name: /Transportation/ }))
    expect(order()[0]).toBe('Transportation')
  })

  it('says paid for a bill settled in a payment or two, and how far ahead a busy row is heading', () => {
    const rows = [
      row(10, 'Allowance', 120000, 120000, 'wants'), row(11, 'Home & DIY', 7900, 10000, 'wants'), row(12, 'Fun', 4400, 10000, 'wants'),
    ]
    render(wrap(<Categories rows={rows} {...props} payments={{ 10: 2, 11: 3, 12: 3 }} elapsed={16 / 31} />))
    const allowance = screen.getByRole('button', { name: /Allowance/ })
    expect(within(allowance).getByText(/of €1\.200 · paid/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Home & DIY/ })).toHaveTextContent('On course for about €150, €50 over')
    expect(screen.getByRole('button', { name: /Fun/ })).not.toHaveTextContent(/On course|paid/)
  })

  it('adds no words when the month is not known', () => {
    const rows = [row(10, 'Allowance', 120000, 120000, 'wants')]
    render(wrap(<Categories rows={rows} {...props} todayPct={null} />))
    expect(screen.getByRole('button', { name: /Allowance/ })).not.toHaveTextContent('paid')
  })
})
