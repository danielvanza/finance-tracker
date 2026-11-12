import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Month from '../pages/Month'
import { api } from '../api'
import type { Pace } from '../types'

const okPace: Pace = {
  month: '2026-11', current_month: '2026-11', status: 'ok',
  start_date: '2026-10-24', end_date: '2026-11-23', today: '2026-11-09',
  days_total: 31, day_number: 17, days_left: 14,
  plan_cents: { needs: 240000, wants: 144000, savings: 96000 },
  actual_cents: { needs: 121000, wants: 90500, savings: 48000 },
  spendable_plan_cents: 384000, spendable_actual_cents: 211500,
  pace_delta_cents: 13300,
  daily: [{ date: '2026-10-24', cumulative_cents: 90000 }, { date: '2026-10-25', cumulative_cents: 211500 }],
  data_through: '2026-11-08',
  last_import_by_bank: [
    { source: 'ing', last_date: '2026-11-08' }, { source: 'manual', last_date: null },
  ],
  behind_months: ['2026-11'], to_review: 14, to_review_in_month: 0, free: null, newest_bank_date: null,
}

vi.mock('../api', () => ({
  api: {
    getPace: vi.fn(),
    getBudget: vi.fn(() => Promise.resolve([])),
    getCategories: vi.fn(() => Promise.resolve([])),
    getTransactions: vi.fn(() => Promise.resolve([])),
    getDashboard: vi.fn(() => Promise.resolve({
      month: '2026-11', total_income_cents: 586026, total_expenses_cents: 342000, total_savings_cents: 40000,
      left_over_cents: 204026, category_breakdown: [],
      income_breakdown: [{ category_id: 18, category_name: 'Retained Salary', amount_cents: 586026 }],
      needs_wants_savings: { needs_cents: 0, wants_cents: 0, savings_cents: 0 },
    })),
  },
  // The recurring link asks for its own data; nothing repeating yet keeps it hidden.
  BASE: '/api',
  apiFetch: vi.fn(() => Promise.resolve({ status: 'none', items: [] })),
  ApiError: class extends Error {},
}))

const show = (pace: Pace) => {
  vi.mocked(api.getPace).mockResolvedValue(pace)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><Month /></MemoryRouter></QueryClientProvider>)
}

describe('Month', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leads with what is left and how that compares to the plan', async () => {
    show(okPace)
    expect(await screen.findByRole('heading', { level: 1, name: '€1.725 left' })).toBeInTheDocument()
    expect(screen.getByText(/€133 more than planned by now/)).toBeInTheDocument()
    expect(screen.getByText('14 transactions to review').closest('a')).toHaveAttribute('href', '/transactions')
    expect(screen.queryByRole('link', { name: 'Bring in bank files' })).toBeNull()
  })

  it('keeps the month report one tap away, under the review row, whatever the status', async () => {
    show(okPace)
    const report = await screen.findByRole('link', { name: 'Month report' })
    expect(report).toHaveAttribute('href', '/report?month=2026-11')
    expect(screen.getByText('14 transactions to review').closest('a')?.parentElement).toBe(report.parentElement)
  })

  it('offers the month report with no review row and no bank files', async () => {
    show({ ...okPace, status: 'empty', daily: [], data_through: null, pace_delta_cents: null, behind_months: [], to_review: 0, to_review_in_month: 0, free: null, newest_bank_date: null })
    expect(await screen.findByRole('link', { name: 'Month report' })).toBeInTheDocument()
    expect(screen.queryByText(/to review/)).toBeNull()
  })

  it('shows the whole month from the summary wire shape', async () => {
    show(okPace)
    expect(await screen.findByText('€5.860,26')).toBeInTheDocument()
    expect(screen.getByText('€3.420,00')).toBeInTheDocument()
    expect(screen.getByText('€2.040,26')).toBeInTheDocument()
    expect(screen.getByText(/Retained Salary/)).toBeInTheDocument()
  })

  it('says when spending ran under plan and how far the files reach', async () => {
    show({ ...okPace, pace_delta_cents: -9000, daily: okPace.daily.slice(0, 1), data_through: '2026-10-24' })
    expect(await screen.findByText(/€90 less than planned by now\. Bank files run to 24 Oct\./)).toBeInTheDocument()
  })

  it('does not guess after a gap: it names the gap and offers the import', async () => {
    show({
      ...okPace, status: 'gap', daily: [], data_through: null, pace_delta_cents: null, to_review: 0, to_review_in_month: 0, free: null, newest_bank_date: null,
      last_import_by_bank: [{ source: 'ing', last_date: '2026-08-12' }, { source: 'manual', last_date: null }],
      behind_months: ['2026-08', '2026-09', '2026-10', '2026-11'],
    })
    expect(await screen.findByRole('heading', { level: 1, name: "Can't tell yet" })).toBeInTheDocument()
    expect(screen.getByText(/stops on 12 Aug/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bring in bank files' })).toHaveAttribute('href', '/import')
    expect(screen.getByText('4 months')).toBeInTheDocument()
    expect(screen.queryByText(/ left$/)).toBeNull()
  })

  it('tells a first run it needs a bank file', async () => {
    show({ ...okPace, status: 'empty', daily: [], data_through: null, pace_delta_cents: null, behind_months: [], to_review: 0, to_review_in_month: 0, free: null, newest_bank_date: null,
      last_import_by_bank: okPace.last_import_by_bank.map(b => ({ ...b, last_date: null })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'No bank files yet' })).toBeInTheDocument()
  })

  it('has nowhere to go past the current month', async () => {
    show(okPace)
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeDisabled()
  })
})
