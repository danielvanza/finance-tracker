import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { merchantFor, ruleKeyOk } from '../components/merchants/merchantKey'
import { buildMerchantModel, coveringRule, labelForDate, monthRange, rankMerchants } from '../components/merchants/merchantData'
import { MerchantName, MerchantSheetProvider, MerchantsView } from '../components/merchants'
import type { Category, Rule, Transaction } from '../types'

const cats: Category[] = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 2, name: 'Clothing', type: 'wants', sort_order: 2 },
  { id: 3, name: 'Salary', type: 'income', sort_order: 3 },
]

let nextId = 1
const tx = (date: string, cents: number, description: string, over: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, date, description, amount_cents: cents, source: 'ing',
  category_id: 1, category_name: 'Food - Essential', confirmed: true, categorised_by: 'rule',
  ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [], ...over,
})

describe('merchantFor', () => {
  it.each([
    ['Albert Heijn 1403 Amsterdam NLD', 'albert heijn', 'Albert Heijn'],
    ['Albert Heijn Amsterdam', 'albert heijn', 'Albert Heijn'],
    ['AMZN Mktp NL*EG11 BV Amsterdam', 'amzn mktp', 'Amazon'],
    ['Bol.com bestelling 1048293771', 'bol.com bestelling', 'Bol.com bestelling'],
    ['Thuisbezorgd.nl', 'thuisbezorgd', 'Thuisbezorgd'],
    ['HEMA', 'hema', 'HEMA'],
    ['Restaurant Den Haag', 'restaurant', 'Restaurant'],
    ['BCK*Bakker Bart 99812', 'bakker bart', 'Bakker Bart'],
    ['*Thuis 4412', 'thuis', 'Thuis'],
    ['Jumbo  Utrecht', 'jumbo', 'Jumbo'],
  ])('%s', (raw, key, name) => {
    const m = merchantFor(raw)
    expect(m.name).toBe(name)
    expect(m.key).toBe(key)
  })

  it('keeps the key inside the raw text, so it works as a rule pattern', () => {
    for (const raw of ['Albert Heijn 1403 Amsterdam NLD', 'AMZN Mktp NL*EG11', 'BCK*Bakker 99812', '*Thuis 4412', 'Jumbo  Utrecht NLD']) {
      expect(raw.toLowerCase()).toContain(merchantFor(raw).key)
    }
  })

  it('refuses keys under 4 characters', () => {
    expect(ruleKeyOk('hema')).toBe(true)
    expect(ruleKeyOk('ns')).toBe(false)
  })
})

describe('financial months', () => {
  it('names a period after the month it ends in', () => {
    expect(labelForDate('2026-10-24', 24)).toBe('2026-11')
    expect(labelForDate('2026-11-23', 24)).toBe('2026-11')
    expect(labelForDate('2026-12-30', 24)).toBe('2027-01')
    expect(monthRange('2026-11', 24)).toEqual({ from: '2026-10-24', to: '2026-11-23' })
    expect(monthRange('2026-01', 24)).toEqual({ from: '2025-12-24', to: '2026-01-23' })
    expect(monthRange('2026-02', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('buildMerchantModel', () => {
  const base = { categories: cats, currentMonth: '2026-11', behindMonths: ['2026-10', '2026-11'], startDay: 24 }

  it('totals six financial months, nets refunds and leaves no-data months empty', () => {
    const t = [
      tx('2026-11-02', -1000, 'Zara 1234 Utrecht'),
      tx('2026-10-30', -2500, 'Zara Utrecht'),
      tx('2026-10-31', 500, 'Zara Utrecht', { is_refund: true }),
      tx('2026-08-01', -4000, 'Zara'),
      tx('2026-09-02', -9999, 'Other shop'),
    ]
    const m = buildMerchantModel({ ...base, key: 'zara', transactions: t })
    expect(m.months.map(x => x.label)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(m.months.map(x => x.cents)).toEqual([0, 0, 4000, 0, 0, 3000])
    expect(m.months[5].partial).toBe(true)
    expect(m.months[4]).toMatchObject({ cents: 0, noData: true, purchases: 0 })
    expect(m.months[3]).toMatchObject({ cents: 0, noData: false })
    expect(m.windowCents).toBe(7000)
    expect(m.history).toHaveLength(4)
  })

  it('finds mixed categories and the purchases a rule would settle', () => {
    const t = [
      tx('2026-11-02', -1000, 'Zara 1001'),
      tx('2026-11-03', -1000, 'Zara 1002', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-11-04', -1000, 'Zara 1003', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-11-05', -1000, 'Zara 1004', { category_id: null, category_name: null, confirmed: false }),
      tx('2026-11-06', -1000, 'Zara 1005', { confirmed: false, is_refund: true }),
    ]
    const m = buildMerchantModel({ ...base, key: 'zara', transactions: t })
    expect(m.categories.map(c => c.name)).toEqual(['Clothing', 'Food - Essential'])
    expect(m.topCategoryId).toBe(2)
    expect(m.unsorted).toBe(1)
    expect(m.waiting.map(w => w.description)).toEqual(['Zara 1004'])
  })

  it('finds a rule that covers the whole key, not one that pins part of it', () => {
    const rule = (id: number, pattern: string): Rule => ({ id, pattern, category_id: 1, category_name: 'Food - Essential' })
    expect(coveringRule('bol.com bestelling', [rule(1, 'bol.com bestelling 1048293771')])).toBeNull()
    expect(coveringRule('bol.com bestelling', [rule(1, 'bol.com')])?.id).toBe(1)
  })
})

describe('rankMerchants', () => {
  it('ranks needs and wants spend, nets refunds, and keeps to the period', () => {
    const t = [
      tx('2026-11-02', -5000, 'Albert Heijn 1403 Amsterdam NLD'),
      tx('2026-11-03', -2000, 'Albert Heijn Amsterdam'),
      tx('2026-11-04', -9000, 'Zara', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-11-05', 4000, 'Zara', { category_id: 2, category_name: 'Clothing', is_refund: true }),
      tx('2026-11-06', 300000, 'Salary ACME', { category_id: 3, category_name: 'Salary' }),
      tx('2026-09-06', -7000, 'Gamma'),
    ]
    const month = rankMerchants(t, cats, { from: '2026-10-24', to: '2026-11-23' })
    expect(month.map(m => [m.name, m.cents, m.purchases])).toEqual([['Albert Heijn', 7000, 2], ['Zara', 5000, 1]])
    expect(rankMerchants(t, cats, null).map(m => m.name)).toEqual(['Albert Heijn', 'Gamma', 'Zara'])
  })
})

/* ---- components, with the api mocked ---- */

const store = vi.hoisted(() => ({ txs: [] as unknown[], rules: [] as unknown[] }))

vi.mock('../api', () => ({
  api: {
    getTransactions: vi.fn(() => Promise.resolve(store.txs)),
    getCategories: vi.fn(() => Promise.resolve(cats)),
    getPace: vi.fn(() => Promise.resolve({
      month: '2026-11', current_month: '2026-11', status: 'ok', start_date: '2026-10-24', end_date: '2026-11-23',
      behind_months: ['2026-11'],
    })),
    getSettings: vi.fn(() => Promise.resolve({ financial_month_start_day: '24' })),
    getRules: vi.fn(() => Promise.resolve(store.rules)),
    createRule: vi.fn(() => Promise.resolve({})),
    patchTransaction: vi.fn(() => Promise.resolve({})),
  },
}))

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><MerchantSheetProvider>{ui}</MerchantSheetProvider></MemoryRouter>
    </QueryClientProvider>,
  )

describe('merchant sheet', () => {
  beforeEach(() => { vi.clearAllMocks(); store.rules = [] })

  const open = async (description: string) => {
    wrap(<MerchantName description={description} />)
    fireEvent.click(screen.getByRole('button', { name: /spend and history/ }))
    return screen.findByRole('dialog')
  }

  it('shows the clean name over the bank text in a row, and plain text without a provider', () => {
    store.txs = []
    render(<MerchantName description="Albert Heijn 1403 Amsterdam NLD" />)
    expect(screen.getByText('Albert Heijn 1403 Amsterdam NLD')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    wrap(<MerchantName description="Albert Heijn 1403 Amsterdam NLD" />)
    expect(screen.getByRole('button', { name: 'Albert Heijn: spend and history' })).toBeInTheDocument()
    expect(screen.getAllByText('Albert Heijn 1403 Amsterdam NLD').length).toBeGreaterThan(0)
  })

  it('opens with total, six bars and history, and sets one rule by the cleaned key', async () => {
    store.txs = [
      tx('2026-11-02', -1000, 'Zara 1234 Utrecht', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-11-03', -2000, 'Zara Utrecht', { category_id: 2, category_name: 'Clothing', confirmed: false }),
      tx('2026-10-03', -3000, 'Zara Utrecht', { category_id: 2, category_name: 'Clothing' }),
    ]
    const waiting = store.txs[1] as Transaction
    const dialog = await open('Zara 1234 Utrecht')
    const d = within(dialog)
    expect(await d.findByText('over 6 months, 3 purchases.', { exact: false })).toBeInTheDocument()
    expect(d.getAllByText('Jun').length).toBe(1)
    expect(d.getByText(/Matches “zara” in any description/)).toBeInTheDocument()
    expect(d.getByText(/1 purchase waiting for review settles now/)).toBeInTheDocument()

    fireEvent.click(d.getByRole('button', { name: 'Set rule' }))
    await waitFor(() => expect(d.getByRole('status')).toHaveTextContent('Rule saved. 1 waiting purchase settled.'))
    const { api } = await import('../api')
    expect(api.createRule).toHaveBeenCalledWith({ pattern: 'zara', category_id: 2 })
    expect(api.patchTransaction).toHaveBeenCalledTimes(1)
    expect(api.patchTransaction).toHaveBeenCalledWith(waiting.id, { category_id: 2, confirmed: true })
  })

  it('keeps the rule button plain when the shop is sorted several ways', async () => {
    store.txs = [
      tx('2026-11-02', -1000, 'Zara 1001', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-11-03', -2000, 'Zara 1002'),
    ]
    const d = within(await open('Zara 1001'))
    const btn = await d.findByRole('button', { name: 'Set rule' })
    expect(btn).not.toHaveClass('btn-primary')
    expect(d.getByText('Sorted as')).toBeInTheDocument()
  })

  it('shows the rule that already covers it, and refuses a key under 4 characters', async () => {
    store.txs = [tx('2026-11-02', -1000, 'Zara 1001')]
    store.rules = [{ id: 9, pattern: 'zara', category_id: 2, category_name: 'Clothing' }]
    const d = within(await open('Zara 1001'))
    expect(await d.findByText(/goes to/)).toHaveTextContent('Anything with “zara” goes to Clothing.')
    expect(d.queryByRole('button', { name: 'Set rule' })).toBeNull()
  })

  it('does not offer a rule for a short key', async () => {
    store.txs = [tx('2026-11-02', -1000, 'NS 12345')]
    const d = within(await open('NS 12345'))
    expect(await d.findByRole('button', { name: 'Set rule' })).toBeDisabled()
    expect(d.getByText(/too short to match safely/)).toBeInTheDocument()
  })
})

describe('MerchantsView', () => {
  it('ranks this month and opens the sheet from a row', async () => {
    store.rules = []
    store.txs = [
      tx('2026-11-02', -5000, 'Albert Heijn 1403 Amsterdam NLD'),
      tx('2026-11-04', -9000, 'Zara', { category_id: 2, category_name: 'Clothing' }),
      tx('2026-09-04', -7000, 'Gamma'),
    ]
    const onView = vi.fn()
    wrap(<MerchantsView onView={onView} />)
    const rows = await screen.findAllByRole('button', { name: /€/ })
    expect(rows[0]).toHaveTextContent('Zara')
    expect(screen.getByText(/24 Oct – 23 Nov · 2 merchants/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(await screen.findByText(/3 merchants/)).toBeInTheDocument()

    fireEvent.click(rows[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(onView).toHaveBeenCalledWith('transactions')
  })
})
