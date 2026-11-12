import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Link, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../api'
import type { Transaction } from '../types'
import { useShellTools } from '../components/shell/useShellTools'
import { useOpenAtTop } from '../components/shell/scroll'
import { AddChip, AddRow, FindButtons } from '../components/shell/Entries'

vi.mock('../api', () => ({
  api: {
    getTransactions: vi.fn(),
    getCategories: vi.fn(() => Promise.resolve([])),
    getPace: vi.fn(() => Promise.resolve({ to_review: 5, to_review_in_month: 0, free: null, newest_bank_date: null })),
  },
  ApiError: class extends Error {},
}))

// The real form is the transactions area's; here it only reports a save.
vi.mock('../components/AddTransactionModal', () => ({
  default: ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => (
    <div className="scrim">
      <input id="add-tx-description" aria-label="Description" />
      <button type="button" onClick={() => { onSaved(); onClose() }}>Save it</button>
    </div>
  ),
}))

const tx = (id: number, description: string, over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-11-04', description, amount_cents: -7928, source: 'ing', category_id: 3,
  category_name: 'Miscellaneous', confirmed: true, categorised_by: 'rule', ai_confidence: null,
  is_refund: false, set_aside_id: null, set_aside_name: null, splits: [], ...over,
})

function Probe() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

function Harness() {
  const { openFind, openAdd, overlays } = useShellTools()
  return (
    <>
      <FindButtons onOpen={openFind} />
      <AddChip onOpen={openAdd} />
      <AddRow onOpen={openAdd} />
      <input aria-label="Some field" />
      <Probe />
      {overlays}
    </>
  )
}

const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Harness /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const press = (key: string, init: KeyboardEventInit = {}, target: Element | Window = window) =>
  fireEvent.keyDown(target, { key, ...init })

describe('Shell find and add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.dataset.theme = 'day'
    vi.mocked(api.getTransactions).mockResolvedValue([tx(1, 'Coolblue'), tx(2, 'Albert Heijn', { category_name: 'Food - Essential' })])
  })

  it('opens the palette on Ctrl-K with pages and actions, and closes on Escape', async () => {
    show()
    press('k', { ctrlKey: true })
    const box = await screen.findByRole('combobox')
    expect(box).toHaveFocus()
    expect(screen.getByRole('option', { name: /Transactions/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Add transaction/ })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Review 5 transactions/ })).toBeInTheDocument()
    press('Escape', {}, box)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('finds a transaction by description, then by category, and opens it in Transactions', async () => {
    show()
    fireEvent.click(screen.getByLabelText('Find or do anything'))
    const box = await screen.findByRole('combobox')
    fireEvent.change(box, { target: { value: 'cool' } })
    const hit = await screen.findByRole('option', { name: /Coolblue/ })
    expect(hit).toHaveTextContent('4 Nov')
    expect(hit).toHaveTextContent('-€79,28')
    fireEvent.change(box, { target: { value: 'food' } })
    expect(await screen.findByRole('option', { name: /Albert Heijn/ })).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'cool' } })
    await screen.findByRole('option', { name: /Coolblue/ })
    press('Enter', {}, box)
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions?q=Coolblue')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    show()
    press('k', { metaKey: true })
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'xyzzy' } })
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('moves with the arrow keys and runs the highlighted row', async () => {
    show()
    press('k', { ctrlKey: true })
    const box = await screen.findByRole('combobox')
    press('ArrowDown', {}, box)
    press('Enter', {}, box)
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions')
  })

  it('flips the theme from the palette until the next sunrise or sunset', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T12:00:00'))
    show()
    press('k', { ctrlKey: true })
    fireEvent.click(await screen.findByRole('option', { name: /Switch to night/ }))
    const saved = JSON.parse(localStorage.getItem('life.theme-override')!)
    expect(saved.theme).toBe('night')
    expect(saved.until).toBeGreaterThan(Date.now())
    vi.useRealTimers()
  })

  it('opens the add form on N, but not while typing, and jumps with g then a letter', async () => {
    show()
    press('n', {}, screen.getByLabelText('Some field'))
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    press('g')
    press('r')
    expect(screen.getByTestId('where')).toHaveTextContent('/trends')
    press('N')
    expect(await screen.findByLabelText('Description')).toBeInTheDocument()
    press('g')
    press('m')
    expect(screen.getByTestId('where')).toHaveTextContent('/trends')
  })

  it('ignores shortcuts while the palette is open', async () => {
    show()
    press('k', { ctrlKey: true })
    await screen.findByRole('combobox')
    press('n')
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
  })

  it('says what was added after a save, in a polite status line', async () => {
    show()
    fireEvent.click(screen.getByLabelText('Add transaction'))
    await screen.findByLabelText('Description')
    await waitFor(() => expect(api.getTransactions).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    vi.mocked(api.getTransactions).mockResolvedValue([
      tx(9, 'Cash groceries', { amount_cents: -1250, category_name: 'Food - Essential' }), tx(1, 'Coolblue'), tx(2, 'Albert Heijn'),
    ])
    fireEvent.click(screen.getByText('Save it'))
    const line = await screen.findByText(/Added · Cash groceries/)
    expect(line).toHaveTextContent('Added · Cash groceries · -€12,50 · Food - Essential')
    expect(line.parentElement).toHaveAttribute('role', 'status')
  })
})

function Pages() {
  const { pathname } = useLocation()
  useOpenAtTop(pathname)
  return <><Link to="/a">a</Link><Link to="/a?q=x">same</Link></>
}

describe('Shell opens pages at the top', () => {
  it('scrolls to the top when the page changes, not on first render', () => {
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as never
    render(<MemoryRouter><Pages /></MemoryRouter>)
    expect(scrollTo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('a'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    scrollTo.mockClear()
    fireEvent.click(screen.getByText('same'))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
