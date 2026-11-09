import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Movers from '../pages/trends/Movers'
import { trendFacts } from '../pages/trends/facts'
import { earlierMonths, findMovers } from '../pages/trends/movers'
import { api } from '../api'
import type { DashboardSummary } from '../types'

vi.mock('../api', () => ({ api: { getDashboard: vi.fn() }, ApiError: class extends Error {} }))

const row = (month: string, needs: number, wants: number, savings: number, income: number, finished = true) => ({
  month, hasData: needs + wants + savings + income > 0, finished,
  total_expenses_cents: needs + wants + savings, needs_cents: needs, wants_cents: wants, savings_cents: savings,
  total_income_cents: income,
})

const summary = (month: string, cats: Array<[number, string, number]>): DashboardSummary => ({
  month, total_income_cents: 0, total_expenses_cents: 0, total_savings_cents: 0, left_over_cents: 0,
  category_breakdown: cats.map(([category_id, category_name, actual_cents]) => ({
    category_id, category_name, actual_cents, planned_cents: 0, type: 'needs' as const,
  })),
  needs_wants_savings: { needs_cents: 0, wants_cents: 0, savings_cents: 0 }, monthly_trend: [], income_breakdown: [],
})

describe('trendFacts', () => {
  const aug = row('2026-08', 247876, 79309, 30000, 420000)
  const sep = row('2026-09', 260105, 75738, 30000, 420000)
  const oct = row('2026-10', 247767, 65336, 30000, 420000)

  it('says what was kept and saved against the month before', () => {
    expect(trendFacts([aug, sep, oct])).toEqual([
      { label: 'Kept', text: 'After needs and wants, 25% of income was left in October, up from 20% in September.' },
      { label: 'Saved', text: '€300 went into savings, the same as in September.' },
    ])
  })

  it('says how savings moved when they did', () => {
    const facts = trendFacts([sep, row('2026-10', 247767, 65336, 45000, 420000)])
    expect(facts[1].text).toBe('€450 went into savings, up from €300 in September.')
  })

  it('has nothing to say about kept without income, and skips savings that are zero in both months', () => {
    expect(trendFacts([row('2026-09', 100000, 0, 0, 0), row('2026-10', 100000, 0, 0, 0)])).toEqual([])
  })

  it('compares finished months only, and says nothing when none is finished', () => {
    expect(trendFacts([sep, oct, row('2026-11', 1, 1, 1, 540000, false)])[0].text).toContain('in October')
    expect(trendFacts([row('2026-11', 1, 1, 1, 540000, false)])).toEqual([])
  })

  it('states the figure without a comparison when it is the only finished month', () => {
    expect(trendFacts([oct])[0].text).toBe('After needs and wants, 25% of income was left in October.')
  })

  it('names an overspend instead of a negative share', () => {
    expect(trendFacts([row('2026-10', 300000, 200000, 0, 400000)])[0].text).toBe('Needs and wants came to €1.000 more than income in October.')
  })
})

describe('movers', () => {
  const rows = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map(m => ({
    month: m, hasData: m >= '2026-08', finished: m < '2026-11',
  }))

  it('uses up to three finished months with spending before the picked one', () => {
    expect(earlierMonths(rows, '2026-10')).toEqual(['2026-08', '2026-09'])
    expect(earlierMonths(rows, '2026-08')).toEqual([])
  })

  it('says nothing for an unfinished month', () => {
    expect(earlierMonths(rows, '2026-11')).toEqual([])
  })

  it('ranks by euro change, ignoring small categories and small moves', () => {
    const earlier = [
      summary('2026-08', [[1, 'Food', 20000], [2, 'Fuel', 9000], [3, 'Tiny', 1000], [4, 'Steady', 30000]]),
      summary('2026-09', [[1, 'Food', 24000], [2, 'Fuel', 9000], [3, 'Tiny', 1000], [4, 'Steady', 30000]]),
    ]
    const current = summary('2026-10', [[1, 'Food', 11000], [2, 'Fuel', 15000], [3, 'Tiny', 9000], [4, 'Steady', 31000]])
    expect(findMovers(current, earlier).map(m => [m.name, m.delta, m.pct])).toEqual([
      ['Food', -11000, 50],
      ['Fuel', 6000, 67],
    ])
  })
})

describe('Movers', () => {
  it('shows the section with sentences and euro changes', async () => {
    vi.mocked(api.getDashboard).mockImplementation(async m =>
      summary(m, [[1, 'Food', m === '2026-08' ? 20000 : 24000], [2, 'Fuel', 9000]]))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rows = [
      { month: '2026-08', hasData: true, finished: true },
      { month: '2026-09', hasData: true, finished: true },
      { month: '2026-10', hasData: true, finished: true },
    ]
    render(
      <QueryClientProvider client={qc}>
        <Movers month="2026-10" summary={summary('2026-10', [[1, 'Food', 11000], [2, 'Fuel', 15000]])} rows={rows} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'What moved in October' })).toBeInTheDocument()
    expect(screen.getByText('Food fell the most, and Fuel rose the most.')).toBeInTheDocument()
    expect(screen.getByText('Against the average of August and September.')).toBeInTheDocument()
    expect(screen.getByText('−€110')).toBeInTheDocument()
    expect(screen.getByText('€110 against €220 on average')).toBeInTheDocument()
    expect(screen.getByText('50% below')).toBeInTheDocument()
  })

  it('renders nothing when the picked month is unfinished', () => {
    const qc = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={qc}>
        <Movers month="2026-11" summary={summary('2026-11', [])} rows={[{ month: '2026-11', hasData: true, finished: false }]} />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
