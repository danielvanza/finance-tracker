import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Month from '../pages/Month'
import Categories from '../pages/month/Categories'
import { api } from '../api'
import type { BudgetRow, FreeToSpend, Pace } from '../types'

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
  last_import_by_bank: [{ source: 'ing', last_date: '2026-11-08' }], behind_months: [], to_review: 0, to_review_in_month: 0, free: null, money_in_cents: 0, ordinary_day: null, newest_bank_date: null, ...over,
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
      needs_wants_savings: { needs_cents: 0, wants_cents: 0, savings_cents: 0 },
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

const free = (over: Partial<FreeToSpend> = {}): FreeToSpend => ({
  free_cents: 168800, per_day_cents: 16880, left_in_plan_cents: 168800, bills_cents: 0, bills: [], set_aside_cents: 0, set_asides: [],
  money_in_cents: 550000, income_expected_cents: 0, income_expected: [], spent_cents: 246200, saved_cents: 0, to_save_cents: 40000,
  cash_left_cents: 263800, outside_plan_cents: 95000, still_to_come_cents: 40000,
  avg_day_cents: 4700, avg_day_days: 21, avg_day_spent_cents: 98800, days_ahead: 9, month_end_cents: 221000, ...over,
})

describe('Month top block: money left to spend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leads with the money left and shows the average day, the month end and the daily budget', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free() }))
    const { container } = render(wrap(<Month />))
    const top = () => within(container.querySelector('.four') as HTMLElement)
    expect(await screen.findByRole('heading', { level: 1, name: 'Left to spend€2.638' })).toBeInTheDocument()
    expect(screen.getByText('After €400 still to come, until payday, 23 Nov')).toBeInTheDocument()
    expect(top().getByText('€47')).toBeInTheDocument()
    expect(top().getByText('€2.210')).toBeInTheDocument()
    expect(screen.getByText('left on 23 Nov')).toBeInTheDocument()
    expect(top().getByText('€169')).toBeInTheDocument()
    expect(screen.getByText('a day, for 15 days')).toBeInTheDocument()
    expect(screen.queryByText(/free to spend/)).toBeNull()
  })

  it('keeps every part of the working in one fold, with the bills and the Not a fixed bill buttons', async () => {
    const bills = [{ key: 'zilveren kruis', name: 'Zilveren Kruis', amount_cents: 26800, next_date: '2026-11-20', category_name: 'Insurance' }]
    vi.mocked(api.getPace).mockResolvedValue(pace({
      free: free({ bills, bills_cents: 26800, set_aside_cents: 4500, set_asides: [{ id: 1, name: 'Car insurance', monthly_cents: 4500 }],
        income_expected_cents: 210000, income_expected: [{ key: 'salary', name: 'Salary', amount_cents: 210000, next_date: '2026-11-12' }] }),
    }))
    render(wrap(<Month />))
    const fold = (await screen.findByText('How this is worked out')).closest('details')!
    for (const text of ['Money in so far', 'Still expected in', 'Spent so far', 'Fixed bills still to come', 'Set aside this month', 'Still to save, as planned']) {
      expect(within(fold).getAllByText(text).length).toBeGreaterThan(0)
    }
    expect(within(fold).getByText(/Salary, 12 Nov/)).toBeInTheDocument()
    expect(within(fold).getByRole('button', { name: 'Zilveren Kruis is not a fixed bill' })).toBeInTheDocument()
    expect(within(fold).getByText('Car insurance')).toBeInTheDocument()
    expect(fold.textContent).toContain('€988 over 21 ordinary days = €47')
    expect(fold.textContent).toContain('over 15 days, today included = €169 a day')
    expect(within(fold).getByText(/€950 of what is left to spend lies outside the plan/)).toBeInTheDocument()
  })

  it("early in the month the average day and the month end read Can't tell yet and say when", async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ day_number: 3, days_left: 28, free: free({ avg_day_cents: null, avg_day_days: null, avg_day_spent_cents: null, month_end_cents: null }) }))
    const { container } = render(wrap(<Month />))
    const top = () => within(container.querySelector('.four') as HTMLElement)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByText("Can't tell yet")).toHaveLength(2)
    expect(screen.getAllByText('shows after day 5')).toHaveLength(2)
    expect(top().getByText('€2.638')).toBeInTheDocument()
  })

  it('says the plan is used up, and short, when the plan and the money run out', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({
      free: free({ free_cents: -24000, per_day_cents: null, cash_left_cents: 71000, month_end_cents: -54000 }),
    }))
    const { container } = render(wrap(<Month />))
    const top = () => within(container.querySelector('.four') as HTMLElement)
    expect(await screen.findByText('plan used up')).toBeInTheDocument()
    expect(top().getByText('€240 over')).toBeInTheDocument()
    expect(top().getByText('€540 short')).toBeInTheDocument()
    expect(screen.getByText('short on 23 Nov')).toBeInTheDocument()
  })

  it('shows a finished month as left over with its average day and the plan result', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({
      day_number: null, days_left: null, money_in_cents: 700000, ordinary_day: { avg_cents: 7800, days: 25, spent_cents: 195000 },
      actual_cents: { needs: 300000, wants: 78000, savings: 190000 }, spendable_actual_cents: 378000, spendable_plan_cents: 415000,
    }))
    const { container } = render(wrap(<Month />))
    const top = () => within(container.querySelector('.four') as HTMLElement)
    expect(await screen.findByRole('heading', { level: 1, name: 'Left over€1.320' })).toBeInTheDocument()
    expect(top().getByText('€78')).toBeInTheDocument()
    expect(screen.getByText('€370 under')).toBeInTheDocument()
    expect(screen.getByText('spent €3.780 of €4.150')).toBeInTheDocument()
    expect(screen.queryByText('How this is worked out')).toBeNull()
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

describe('Month links to the payments behind its figures', () => {
  beforeEach(() => vi.clearAllMocks())


  it('ends the caveat about waiting payments with a link to answer them, and shows neither without any', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free(), to_review_in_month: 6 }))
    const { unmount } = render(wrap(<Month />))
    const link = await screen.findByRole('link', { name: 'Answer them' })
    expect(link).toHaveAttribute('href', '/transactions')
    expect(link.closest('p')).toHaveTextContent('6 payments this month still wait for an answer and are not counted.')
    unmount()
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free(), to_review_in_month: 0 }))
    render(wrap(<Month />))
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: /Answer (it|them)/ })).toBeNull()
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
  const props = { month: '2026-11', isCurrent: true, categories: [], todayPct: 50, payments: null, elapsed: null, onError: () => {} }

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
  it('ends an opened category with a link to all its payments, only when it has some', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getTransactions).mockImplementation(p => Promise.resolve(p?.category_id === '2'
      ? [{ id: 9, date: '2026-11-03', amount_cents: -2500, description: 'Albert Heijn', source: 'ing', category_id: 2, category_name: 'Food', confirmed: true,
        categorised_by: 'rule', ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [] }]
      : []))
    const { rerender } = render(wrap(<Categories rows={base} {...props} />))
    await user.click(screen.getByRole('button', { name: /Taxes/ }))
    await screen.findByText('No confirmed transactions this month.')
    expect(screen.queryByRole('link', { name: 'All payments' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Taxes/ }))
    await user.click(screen.getByRole('button', { name: /Food/ }))
    expect(await screen.findByRole('link', { name: 'All payments' })).toHaveAttribute('href', '/transactions?category=2&month=1')
    // A past month has no "this month" to carry over.
    rerender(wrap(<Categories rows={base} {...props} isCurrent={false} />))
    expect(await screen.findByRole('link', { name: 'All payments' })).toHaveAttribute('href', '/transactions?category=2')
  })
})
