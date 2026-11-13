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
    alwaysAsk: vi.fn(() => Promise.resolve({ pattern: 'albert heijn amsterdam', removed_rules: ['albert heijn'] })),
  },
  ApiError: class extends Error {},
}))

const tx = (id: number, over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-11-05', amount_cents: -2500, description: `Shop ${id}`, source: 'ing',
  category_id: 1, category_name: 'Food - Essential', confirmed: true, categorised_by: 'rule',
  ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [], ...over,
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
  tx(1, { description: 'Albert Heijn Amsterdam', amount_cents: -2903 }),
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

  it('changes a category on its row, then offers to always ask about a shop it sorted by itself', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Change the category of Albert Heijn Amsterdam/ }))
    await user.click(await screen.findByRole('option', { name: 'Utilities' }))
    await waitFor(() => expect(api.patchTransaction).toHaveBeenCalledWith(1, { category_id: 2, is_refund: false, confirmed: true }))
    const offer = (await screen.findByText(/Moved to Utilities/)).closest('.tx-offer') as HTMLElement
    await user.click(within(offer).getByRole('button', { name: 'Always ask about this shop' }))
    expect(api.alwaysAsk).toHaveBeenCalledWith(1)
    expect(await screen.findByText(/each payment there\. The rule “albert heijn” is gone/)).toBeInTheDocument()
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

  it('offers the CSV chip, with the filtered list as its rows', async () => {
    show('/transactions?q=jumbo')
    const chip = await screen.findByRole('button', { name: /CSV/ })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(chip).toBeEnabled()
  })
  it('holds the chips in the address: restores them on arrival, writes each one, and Clear takes them out', async () => {
    show('/transactions?review=1&over=1&category=999&source=zzz')
    await screen.findByText('115 to review')
    // An unknown category and an unknown source are ignored; the others apply.
    expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Needs review/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Over €100' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Over €100' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/transactions\?review=1&category=999&source=zzz$/)
    await userEvent.click(screen.getByRole('button', { name: /^This month/ }))
    expect(screen.getByTestId('where')).toHaveTextContent(/review=1&category=999&source=zzz&month=1$/)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/transactions$/)
    await waitFor(() => expect(rows()).toHaveLength(4))
  })

  it('opens with the category and month chips a link from Month asks for', async () => {
    show('/transactions?category=2&month=1')
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.getByRole('button', { name: /^Utilities/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^This month/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
  })

  it('sorts a waiting row from its own cell: it says Pick… and picking confirms it', async () => {
    show()
    const user = userEvent.setup()
    const pick = await screen.findByRole('button', { name: 'Change the category of Etsy.com (now none)' })
    expect(pick).toHaveTextContent('Pick…')
    await user.click(pick)
    await user.click(await screen.findByRole('option', { name: 'Utilities' }))
    await waitFor(() => expect(api.patchTransaction).toHaveBeenCalledWith(4, { category_id: 2, is_refund: false, confirmed: true }))
  })

  describe('after an answer on the review card', () => {
    const asked = tx(10, { description: 'Etos Apotheek', confirmed: false, category_id: null, category_name: null, categorised_by: null })
    const later = (over: Partial<Transaction> = {}) =>
      tx(11, { description: 'Etos Apotheek', confirmed: false, category_id: null, category_name: null, categorised_by: null, ...over })

    // The shop has a second waiting payment; answering the first settles it. `afterwards` is how that
    // second payment stands when Undo looks (changed by someone else, or not).
    const review = async (afterwards: Partial<Transaction> = {}) => {
      let answered = false
      const settled = later({ confirmed: true, category_id: 2, category_name: 'Utilities', categorised_by: 'rule', ...afterwards })
      vi.mocked(api.getTransactions).mockImplementation(p => {
        if (p?.confirmed === 'false') return Promise.resolve(answered ? [] : [asked, later()])
        return Promise.resolve(answered ? [...list, { ...asked, confirmed: true, category_id: 2, category_name: 'Utilities', categorised_by: 'manual' }, settled] : list)
      })
      vi.mocked(api.getNextReview).mockImplementation(() => Promise.resolve(answered ? null : asked))
      vi.mocked(api.patchTransaction).mockImplementation(async (_id, body) => { if (body.confirmed) answered = true; return {} })
      vi.mocked(api.getCategories).mockResolvedValue(categories)
      vi.mocked(api.getPace).mockResolvedValue(pace)
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(<QueryClientProvider client={qc}><MemoryRouter><Transactions /></MemoryRouter></QueryClientProvider>)
      const user = userEvent.setup()
      await screen.findByText('2 to review')
      await user.click(await screen.findByRole('button', { name: /Select category/ }))
      await user.click(await screen.findByRole('option', { name: 'Utilities' }))
      await user.click(screen.getByRole('button', { name: 'Confirm category' }))
      await screen.findByText('Sorted Etos Apotheek as Utilities. 1 more followed.')
      return user
    }

    it('says what was sorted and what followed, and Undo puts back exactly those', async () => {
      const user = await review()
      expect(screen.getByText('Sorted Etos Apotheek as Utilities. 1 more followed.').closest('[role="status"]')).not.toBeNull()
      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Put Etos Apotheek back in the queue with 1 more.')).toBeInTheDocument()
      expect(api.patchTransaction).toHaveBeenCalledWith(10, { confirmed: false })
      expect(api.patchTransaction).toHaveBeenCalledWith(11, { confirmed: false })
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    })

    it('leaves a payment alone when it was changed after the answer, and says so', async () => {
      const user = await review({ category_id: 1, category_name: 'Food - Essential', categorised_by: 'manual' })
      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('1 of 2 put back in the queue')).toBeInTheDocument()
      expect(screen.getByText(/1 was changed since/)).toBeInTheDocument()
      expect(api.patchTransaction).toHaveBeenCalledWith(10, { confirmed: false })
      expect(api.patchTransaction).not.toHaveBeenCalledWith(11, { confirmed: false })
    })
  })
})
