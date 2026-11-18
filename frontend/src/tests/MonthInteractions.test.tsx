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

  it('leads with what is free until payday, a day at a time', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free() }))
    render(wrap(<Month />))
    expect(await screen.findByRole('heading', { level: 1, name: '€1.688,00' })).toBeInTheDocument()
    expect(screen.getByText('Free in the plan', { selector: '.ov-label' })).toBeInTheDocument()
    expect(screen.getByText('About €169 a day')).toBeInTheDocument()
    expect(screen.getByText('15 days to payday, today included.')).toBeInTheDocument()
  })

  it('shows what is left in the account beside the plan, and each fold sum ends on its figure', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free() }))
    render(wrap(<Month />))
    const account = (await screen.findByText('Left in the account', { selector: '.ov-label' })).parentElement!
    expect(account.querySelector('.amount')!.getAttribute('aria-label')).toBe('€2.638,00')
    const fold = screen.getByText('How this is worked out').closest('details')!
    const sums = [...fold.querySelectorAll('.sum')].map(s => s.textContent)
    expect(sums[0]).toBe('Free in the plan€1.688')
    expect(sums[1]).toContain('Left in the account')
  })

  it('lists the bills and set-asides still to pay before payday, soonest first', async () => {
    const bills = [
      { key: 'ziggo', name: 'Ziggo', amount_cents: 6200, next_date: '2026-11-20', category_name: 'Utilities' },
      { key: 'zilveren kruis', name: 'Zilveren Kruis', amount_cents: 26800, next_date: '2026-11-12', category_name: 'Insurance' },
    ]
    vi.mocked(api.getPace).mockResolvedValue(pace({
      free: free({ bills, bills_cents: 33000, set_aside_cents: 4500, set_asides: [{ id: 1, name: 'Car insurance', monthly_cents: 4500 }] }),
    }))
    render(wrap(<Month />))
    const card = (await screen.findByRole('heading', { name: /Still to pay before payday/ })).closest('section')!
    expect(within(card).getByRole('heading').textContent).toContain('€375')
    const names = within(card).getAllByRole('listitem').map(li => li.textContent)
    expect(names[0]).toContain('Zilveren Kruis')
    expect(names[1]).toContain('Ziggo')
    expect(names[2]).toContain('Car insurance')
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
    expect(fold.textContent).toContain('That is €950 more than the plan')
  })

  it('early in the month the working says when the average day shows', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ day_number: 3, days_left: 28, free: free({ avg_day_cents: null, avg_day_days: null, avg_day_spent_cents: null, month_end_cents: null }) }))
    render(wrap(<Month />))
    const fold = (await screen.findByText('How this is worked out')).closest('details')!
    expect(fold.textContent).toContain('Shows once five days of the month are over')
    expect(screen.getByRole('heading', { level: 1, name: '€1.688,00' })).toBeInTheDocument()
  })

  it('says the plan is used up when nothing is free until payday', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({
      free: free({ free_cents: -24000, per_day_cents: null, cash_left_cents: 71000, month_end_cents: -54000 }),
    }))
    render(wrap(<Month />))
    expect(await screen.findByText('Over the plan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '€240,00' })).toBeInTheDocument()
    expect(screen.getByText('The plan is used up')).toBeInTheDocument()
    expect(screen.getByText('15 days to payday, today included.')).toBeInTheDocument()
  })

  it('shows a finished month against its plan, with no working to show', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({
      day_number: null, days_left: null, money_in_cents: 700000, ordinary_day: { avg_cents: 7800, days: 25, spent_cents: 195000 },
      actual_cents: { needs: 300000, wants: 78000, savings: 190000 }, spendable_actual_cents: 378000, spendable_plan_cents: 415000,
    }))
    render(wrap(<Month />))
    expect(await screen.findByRole('heading', { level: 1, name: '€370,00' })).toBeInTheDocument()
    expect(screen.getByText('Under the plan')).toBeInTheDocument()
    expect(screen.getByText('Spent €3.780 of €4.150 planned.')).toBeInTheDocument()
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
    // The figure's full value (its label); the digits on screen may still be counting up.
    const before = heading.querySelector('.amount')!.getAttribute('aria-label')

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).querySelector('.amount')!.getAttribute('aria-label')).toBe(before)
    const body = container.querySelector('.ov')!
    expect(body).toHaveClass('is-loading')
    expect(body).toHaveAttribute('aria-busy', 'true')

    release(pace({ month: '2026-10', day_number: null, days_left: null, start_date: '2026-09-24', end_date: '2026-10-23', spendable_actual_cents: 313100 }))
    await waitFor(() => expect(container.querySelector('.ov')).not.toHaveClass('is-loading'))
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


  it('puts payments to sort and categories over plan under Needs you, and says All sorted without any', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free(), to_review: 6 }))
    vi.mocked(api.getCategories).mockResolvedValueOnce([{ id: 3, name: 'Utilities', type: 'needs', sort_order: 1 }])
    vi.mocked(api.getBudget).mockResolvedValueOnce([
      { id: 1, category_id: 3, category_name: 'Utilities', month: '2026-11', planned_amount_cents: 20000, actual_amount_cents: 23900 },
    ])
    const { unmount } = render(wrap(<Month />))
    expect((await screen.findByText('6 payments to sort')).closest('a')).toHaveAttribute('href', '/transactions?review=1')
    expect((await screen.findByText('Utilities is €39 over')).closest('a')).toHaveAttribute('href', '/transactions?category=3&month=1')
    unmount()
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free(), to_review: 0 }))
    render(wrap(<Month />))
    expect(await screen.findByText('All sorted')).toBeInTheDocument()
    expect(screen.queryByText(/payments? to sort/)).toBeNull()
  })
})

describe('Needs you keeps small overruns quiet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gives a big overrun its own red row and folds the small ones into one line', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ free: free() }))
    vi.mocked(api.getCategories).mockResolvedValueOnce([
      { id: 1, name: 'Clothing', type: 'wants', sort_order: 1 },
      { id: 2, name: 'Takeaway', type: 'wants', sort_order: 2 },
      { id: 3, name: 'Cinema', type: 'wants', sort_order: 3 },
    ])
    vi.mocked(api.getBudget).mockResolvedValueOnce([
      { id: 1, category_id: 1, category_name: 'Clothing', month: '2026-11', planned_amount_cents: 10000, actual_amount_cents: 20800 },
      { id: 2, category_id: 2, category_name: 'Takeaway', month: '2026-11', planned_amount_cents: 20000, actual_amount_cents: 20600 },
      { id: 3, category_id: 3, category_name: 'Cinema', month: '2026-11', planned_amount_cents: 10000, actual_amount_cents: 10300 },
    ])
    render(wrap(<Month />))
    expect((await screen.findByText('Clothing is €108 over')).closest('.ov-row')!.querySelector('.is-over')).not.toBeNull()
    const little = screen.getByText('2 categories a little over').closest('.ov-row')!
    expect(little.querySelector('.is-watch')).not.toBeNull()
    expect(little.textContent).toContain('Takeaway €6 · Cinema €3')
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
