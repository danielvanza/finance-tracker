import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Transactions from '../pages/Transactions'
import { api } from '../api'
import type { Category, Pace, Transaction } from '../types'

vi.mock('../api', () => ({
  api: {
    getTransactions: vi.fn(),
    getNextReview: vi.fn(() => Promise.resolve(null)),
    getCategories: vi.fn(),
    getPace: vi.fn(),
    patchTransaction: vi.fn(() => Promise.resolve({})),
    deleteTransaction: vi.fn(() => Promise.resolve({})),
    createRule: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class extends Error {},
}))

const tx = (id: number, over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-11-05', amount_cents: -2500, description: `Shop ${id}`, source: 'ing',
  category_id: 1, category_name: 'Food - Essential', confirmed: true, categorised_by: 'rule',
  ai_confidence: null, is_refund: false, standing_adjustment_id: null, splits: [], ...over,
})

const categories: Category[] = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 2, name: 'Utilities', type: 'needs', sort_order: 2 },
]

const pace = {
  month: '2026-11', current_month: '2026-11', status: 'ok', start_date: '2026-10-24', end_date: '2026-11-23',
} as Pace

// 4 rows on screen; the review queue holds 115 (most of it not in the list a filter leaves).
const list = [
  tx(1, { description: 'Albert Heijn Amsterdam', source: 'revolut', amount_cents: -2903 }),
  tx(2, { description: 'Jumbo Utrecht', amount_cents: -15000, date: '2026-09-01' }),
  tx(3, { description: 'Lunch with Sam', source: 'manual', category_id: 2, category_name: 'Utilities', amount_cents: -1200 }),
  tx(4, { description: 'Etsy.com', confirmed: false, category_id: null, category_name: null, categorised_by: 'ai', ai_confidence: 0.7 }),
]
const waiting = Array.from({ length: 115 }, (_, i) => tx(100 + i, { confirmed: false }))

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}

function Go() {
  const go = useNavigate()
  return <button type="button" onClick={() => go('/transactions?q=etsy')}>go to etsy</button>
}

const show = (url = '/transactions', rowsOnShow: Transaction[] | 'loading' = list) => {
  vi.mocked(api.getTransactions).mockImplementation(p =>
    p?.confirmed === 'false' ? Promise.resolve(waiting) : rowsOnShow === 'loading' ? new Promise(() => {}) : Promise.resolve(rowsOnShow))
  vi.mocked(api.getCategories).mockResolvedValue(categories)
  vi.mocked(api.getPace).mockResolvedValue(pace)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><Transactions /><Where /><Go /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const rows = () => screen.getAllByRole('row').slice(1)

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom has none
  })

  it('counts the review queue on its own, whatever the list is filtered to', async () => {
    show()
    expect(await screen.findByText('115 to review')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Source' }))
    await userEvent.click(screen.getByRole('option', { name: 'MANUAL' }))
    expect(await screen.findByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByText('115 to review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close review' })).toBeInTheDocument()
    expect(api.getTransactions).toHaveBeenCalledWith({ confirmed: 'false' })
  })

  it('keeps the review count while the list is still loading', async () => {
    show('/transactions', 'loading')
    expect(await screen.findByText('115 to review')).toBeInTheDocument()
    expect(screen.getByLabelText('Loading transactions')).toBeInTheDocument()
  })

  it('opens with the search from the URL applied', async () => {
    show('/transactions?q=albert')
    expect(await screen.findByDisplayValue('albert')).toBeInTheDocument()
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(within(rows()[0]).getByText('Albert Heijn Amsterdam')).toBeInTheDocument()
  })

  it('takes a new ?q= from a link while already on the page', async () => {
    show()
    await waitFor(() => expect(rows()).toHaveLength(4))
    await userEvent.type(screen.getByLabelText('Search transactions'), 'jum')
    await userEvent.click(screen.getByRole('button', { name: 'go to etsy' }))
    expect(await screen.findByDisplayValue('etsy')).toBeInTheDocument()
    await waitFor(() => expect(rows()).toHaveLength(1))
  })

  it('writes what is typed to ?q= and clears it again', async () => {
    show()
    const box = await screen.findByLabelText('Search transactions')
    await userEvent.type(box, 'jumbo')
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions?q=jumbo')
    await waitFor(() => expect(rows()).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/transactions$/)
    await waitFor(() => expect(rows()).toHaveLength(4))
  })

  it('finds an amount as it is shown, and says when nothing matches', async () => {
    show()
    const box = await screen.findByLabelText('Search transactions')
    await userEvent.type(box, '29,03')
    await waitFor(() => expect(rows()).toHaveLength(1))
    await userEvent.clear(box)
    await userEvent.type(box, 'zzz')
    expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(rows()).toHaveLength(4))
  })

  it('narrows with the chips: needs review, this month (financial), over 100, category', async () => {
    show()
    await screen.findByText('115 to review')
    await waitFor(() => expect(rows()).toHaveLength(4))
    await userEvent.click(screen.getByRole('button', { name: /^This month/ }))
    expect(rows()).toHaveLength(3) // the September row is outside 24 Oct to 23 Nov
    await userEvent.click(screen.getByRole('button', { name: /^This month/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Over €100' }))
    expect(rows()).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Over €100' }))
    await userEvent.click(screen.getByRole('button', { name: /^Needs review/ }))
    expect(rows()).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /^Needs review/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Category/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Utilities/ }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
  })

  it('confirms several ticked rows and leaves the failed one ticked', async () => {
    const pending = [tx(5, { description: 'Bol.com', confirmed: false }), tx(6, { description: 'Etsy shop', confirmed: false })]
    show('/transactions', [...list, ...pending])
    vi.mocked(api.patchTransaction).mockImplementation(id => (id === 6 ? Promise.reject(new Error('no')) : Promise.resolve({})))
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(await screen.findByLabelText('Select Bol.com'))
    await userEvent.click(screen.getByLabelText('Select Etsy shop'))
    expect(screen.queryByRole('button', { name: /^Delete \d+$/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 2' }))
    expect(await screen.findByText('1 of 2 saved')).toBeInTheDocument()
    expect(api.patchTransaction).toHaveBeenCalledWith(5, { category_id: 1, confirmed: true })
    expect(screen.getByLabelText('Select Bol.com')).not.toBeChecked()
    expect(screen.getByLabelText('Select Etsy shop')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('offers Delete only when every ticked row is manual', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(await screen.findByLabelText('Select Lunch with Sam'))
    const bar = screen.getByRole('region', { name: 'Selected transactions' })
    expect(within(bar).getByRole('button', { name: 'Delete 1' })).toBeInTheDocument()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete 1' }))
    await waitFor(() => expect(api.deleteTransaction).toHaveBeenCalledWith(3))
  })

  it('names each row by its shop, with the bank text beneath, and opens the merchant sheet', async () => {
    show()
    expect(await screen.findByRole('button', { name: 'Albert Heijn: spend and history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jumbo: spend and history' })).toBeInTheDocument()
    expect(screen.getAllByText('Albert Heijn Amsterdam').length).toBeGreaterThan(0)
  })

  it('makes the review rule for the shop, not the bank text with its order number', async () => {
    const review = tx(9, {
      description: 'Coolblue 20551 Rotterdam NLD', confirmed: false, category_id: 1, category_name: 'Food - Essential',
      categorised_by: 'ai', ai_confidence: 0.7,
    })
    vi.mocked(api.getNextReview).mockResolvedValue(review)
    show('/transactions', [review])
    await userEvent.click(await screen.findByRole('button', { name: 'Always categorise "Coolblue" as this' }))
    await waitFor(() => expect(api.createRule).toHaveBeenCalledWith({ pattern: 'coolblue', category_id: 1, priority: 0 }))
    expect(api.patchTransaction).toHaveBeenCalledWith(9, { category_id: 1 })
  })

  it('offers the CSV chip, with the filtered list as its rows', async () => {
    show('/transactions?q=jumbo')
    const chip = await screen.findByRole('button', { name: /CSV/ })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(chip).toBeEnabled()
  })
})
