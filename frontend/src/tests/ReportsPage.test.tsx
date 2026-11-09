import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReportPage from '../components/reports/ReportPage'
import ReportLink from '../components/reports/ReportLink'
import YourData from '../components/reports/YourData'
import { buildReport, footerText, reportText } from '../components/reports/model'
import { api } from '../api'
import type { BudgetRow, DashboardSummary, Pace, Transaction } from '../types'

vi.mock('../api', () => ({
  BASE: '/api',
  api: { getPace: vi.fn(), getBudget: vi.fn(), getDashboard: vi.fn(), getTransactions: vi.fn() },
  ApiError: class extends Error { status = 0; detail = null },
}))

const pace = (month: string, over: Partial<Pace> = {}): Pace => ({
  month, current_month: '2026-10', status: 'ok',
  start_date: month === '2026-10' ? '2026-09-24' : '2026-08-24', end_date: month === '2026-10' ? '2026-10-23' : '2026-09-23',
  today: '2026-11-09', days_total: 30, day_number: null, days_left: null,
  plan_cents: { needs: 325000, wants: 210000, savings: 40000 },
  actual_cents: { needs: 247800, wants: 65300, savings: 30000 },
  spendable_plan_cents: 535000, spendable_actual_cents: 313100,
  pace_delta_cents: null, daily: [], data_through: '2026-10-23',
  last_import_by_bank: [], behind_months: [], to_review: 5, ...over,
})

const row = (id: number, name: string, type: 'needs' | 'wants' | 'savings', planned: number, actual: number): BudgetRow => ({
  id, category_id: id, category_name: name, category_type: type, month: null, planned_amount_cents: planned, actual_amount_cents: actual,
})

const budget: BudgetRow[] = [
  row(1, 'Taxes & Mortgage', 'needs', 200000, 185000),
  row(2, 'Transportation', 'needs', 20000, 15200),
  row(3, 'Insurance', 'needs', 40000, 0), // planned, nothing spent
  row(4, 'Clothing', 'wants', 10000, 15500),
  row(5, 'DEGIRO', 'savings', 30000, 30000),
]

const summary = (over: Partial<DashboardSummary> = {}, breakdown: DashboardSummary['category_breakdown'] = []): DashboardSummary => ({
  month: '2026-10', total_income_cents: 420000, total_expenses_cents: 343103, total_savings_cents: 30000, left_over_cents: 76897,
  category_breakdown: breakdown,
  income_breakdown: [{ category_id: 9, category_name: 'Salary', amount_cents: 420000 }],
  needs_wants_savings: { needs_cents: 0, wants_cents: 0, savings_cents: 0 }, monthly_trend: [], ...over,
})

const bd = (id: number, name: string, type: 'needs' | 'wants' | 'savings', actual: number) =>
  ({ category_id: id, category_name: name, actual_cents: actual, planned_cents: 0, type })

const txs = (confirmed: number, unconfirmed: number): Transaction[] =>
  Array.from({ length: confirmed + unconfirmed }, (_, i) => ({
    id: i, date: '2026-10-05', description: `T${i}`, amount_cents: -100, source: 'ing', category_id: 1, category_name: 'Utilities',
    confirmed: i < confirmed, categorised_by: null, ai_confidence: null, is_refund: false, standing_adjustment_id: null, splits: [],
  } as Transaction))

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname}{l.search}</output>
}

const show = (path = '/report?month=2026-10') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/report" element={<ReportPage />} /></Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const wire = (opts: { priorPace?: Partial<Pace>; tx?: Transaction[] } = {}) => {
  vi.mocked(api.getPace).mockImplementation(async (m?: string) =>
    m === '2026-09' ? pace('2026-09', opts.priorPace) : pace(m ?? '2026-10'))
  vi.mocked(api.getBudget).mockResolvedValue(budget)
  vi.mocked(api.getDashboard).mockImplementation(async (m: string) =>
    m === '2026-09'
      ? summary({ month: '2026-09' }, [
        bd(1, 'Taxes & Mortgage', 'needs', 185000), bd(2, 'Transportation', 'needs', 9400), bd(4, 'Clothing', 'wants', 22200),
        bd(7, 'Sports', 'wants', 12000), bd(5, 'DEGIRO', 'savings', 30000),
      ])
      : summary({}, [bd(1, 'Taxes & Mortgage', 'needs', 185000), bd(2, 'Transportation', 'needs', 15200), bd(4, 'Clothing', 'wants', 15500), bd(5, 'DEGIRO', 'savings', 30000)]))
  vi.mocked(api.getTransactions).mockResolvedValue(opts.tx ?? txs(35, 5))
}

describe('ReportPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leads with the verdict and the plan by kind', async () => {
    wire()
    show()
    expect(await screen.findByRole('heading', { level: 1, name: '€2.219 left' })).toBeInTheDocument()
    expect(screen.getByText('€3.131 spent of €5.350 planned. Saved €300 of €400.')).toBeInTheDocument()
    expect(screen.getByText(/^24 Sept? – 23 Oct 2026/)).toBeInTheDocument()
    const plan = screen.getByRole('heading', { name: 'Against the plan' }).closest('section')!
    expect(within(plan).getByText('€2.478 of €3.250')).toBeInTheDocument()
  })

  it('lists every planned category, over-plan ones as over, and compares with the month before', async () => {
    wire()
    show()
    const needs = (await screen.findByRole('region', { name: 'Needs' }))
    expect(within(needs).getByText('Insurance').closest('li')).toHaveTextContent(/€0of €400same as Sept?/)
    expect(within(needs).getByText('Transportation').closest('li')).toHaveTextContent('€152of €200€58 more')
    expect(within(needs).getByText('Taxes & Mortgage').closest('li')).toHaveTextContent(/same as Sept?/)
    const wants = screen.getByRole('region', { name: 'Wants' })
    expect(within(wants).getByText('Clothing').closest('li')).toHaveTextContent('€55 over€155 of €100€67 less')
  })

  it('says what moved, including a category with nothing this month', async () => {
    wire()
    show()
    const moved = (await screen.findByRole('heading', { name: 'What moved' })).closest('section')!
    expect(within(moved).getByRole('heading', { name: 'More than September' })).toBeInTheDocument()
    expect(within(moved).getByText('Transportation').closest('li')).toHaveTextContent('€58 more€94 to €152')
    expect(within(moved).getByRole('heading', { name: 'Less than September' })).toBeInTheDocument()
    expect(within(moved).getByText('Sports').closest('li')).toHaveTextContent('€120 less€120 to €0')
    expect(within(moved).getByText('Clothing').closest('li')).toHaveTextContent('€67 less')
  })

  it('skips the comparison when the month before has no bank data', async () => {
    wire({ priorPace: { status: 'gap' } })
    show()
    await screen.findByRole('heading', { level: 1, name: '€2.219 left' })
    expect(screen.queryByRole('heading', { name: 'What moved' })).toBeNull()
    expect(screen.queryByText(/same as/)).toBeNull()
    expect(screen.queryByText(/Since/)).toBeNull()
  })

  it('says how many transactions are still to review in the footer', async () => {
    wire()
    show()
    expect(await screen.findByText(/from 35 confirmed transactions\. 5 transactions still to review are not counted\./)).toBeInTheDocument()
    expect(api.getTransactions).toHaveBeenCalledWith({ month: '2026-10' })
  })

  it('does not claim a verdict when no bank file reaches the month', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace('2026-10', { status: 'gap', data_through: null }))
    vi.mocked(api.getBudget).mockResolvedValue(budget)
    vi.mocked(api.getDashboard).mockResolvedValue(summary())
    vi.mocked(api.getTransactions).mockResolvedValue([])
    show()
    expect(await screen.findByRole('heading', { level: 1, name: "Can't tell yet" })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Against the plan' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'The whole month' })).toBeNull()
    expect(screen.getByText(/Nothing is waiting for review\./)).toBeInTheDocument()
  })

  it('moves between months through the address', async () => {
    wire()
    show()
    await screen.findByRole('heading', { level: 1, name: '€2.219 left' })
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/report?month=2026-09'))
  })

  it('shows the current month when the address names none', async () => {
    wire()
    show('/report')
    await screen.findByRole('heading', { level: 1, name: '€2.219 left' })
    expect(api.getPace).toHaveBeenCalledWith(undefined)
  })

  it('copies the same lines it shows', async () => {
    wire()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy text' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0] as string
    expect(text).toMatch(/^Finances, 24 Sept? – 23 Oct 2026\n€2.219 left\n€3.131 spent of €5.350 planned\./)
    expect(text).toContain('- Clothing: €55 over (€155 of €100, €67 less)')
    expect(text).toContain('Income €4.200,00, spent €3.431,03, saved €300,00, net €768,97')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('prints through the browser', async () => {
    wire()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Print/ }))
    expect(print).toHaveBeenCalled()
  })
})

describe('report model', () => {
  it('words the footer for one transaction and for none to review', () => {
    const base = buildReport({ pace: pace('2026-10'), budget: [], summary: summary(), previous: undefined, transactions: txs(1, 0) })
    expect(footerText(base, new Date(2026, 10, 9))).toBe('Made on 9 Nov 2026 from 1 confirmed transaction. Nothing is waiting for review.')
    const one = buildReport({ pace: pace('2026-10'), budget: [], summary: summary(), previous: undefined, transactions: txs(2, 1) })
    expect(footerText(one, new Date(2026, 10, 9))).toContain('1 transaction still to review is not counted.')
    const none = buildReport({ pace: pace('2026-10'), budget: [], summary: summary(), previous: undefined, transactions: undefined })
    expect(footerText(none, new Date(2026, 10, 9))).toBe('Made on 9 Nov 2026.')
  })

  it('adds a category that has spending but no plan row', () => {
    const r = buildReport({
      pace: pace('2026-10'), budget: [], summary: summary({}, [bd(8, 'Gifts', 'wants', 4000)]), previous: undefined, transactions: [],
    })
    expect(r.groups[0].rows[0]).toMatchObject({ name: 'Gifts', spent: 4000, plan: 0, before: null })
    expect(reportText(r, new Date(2026, 10, 9))).toContain('- Gifts: €40 (no plan)')
  })

  it('says over when the spendable plan is passed', () => {
    const r = buildReport({
      pace: pace('2026-10', { spendable_actual_cents: 600000 }), budget: [], summary: summary(), previous: undefined, transactions: [],
    })
    expect(r.headline).toBe('€650 over')
  })
})

describe('ReportLink', () => {
  it('links to the month and keeps the rows given above it', () => {
    render(
      <MemoryRouter>
        <ReportLink month="2026-10"><a className="link-row" href="/transactions">5 to review</a></ReportLink>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Month report' })).toHaveAttribute('href', '/report?month=2026-10')
    const rows = screen.getAllByRole('link')
    expect(rows[0]).toHaveTextContent('5 to review')
  })
})

describe('YourData', () => {
  it('links the backup and downloads every transaction', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(api.getTransactions).mockResolvedValue(txs(2, 0))
    render(<YourData />)
    expect(screen.getByRole('link', { name: /Back up everything/ })).toHaveAttribute('href', '/api/reports/backup')
    fireEvent.click(screen.getByRole('button', { name: /All transactions/ }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(api.getTransactions).toHaveBeenCalledWith()
    click.mockRestore()
  })

  it('says so when the transactions could not be fetched', async () => {
    vi.mocked(api.getTransactions).mockRejectedValue(new Error('x'))
    render(<YourData />)
    fireEvent.click(screen.getByRole('button', { name: /All transactions/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
