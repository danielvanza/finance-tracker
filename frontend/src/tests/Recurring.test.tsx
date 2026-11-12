import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecurringLink from '../components/recurring/RecurringLink'
import RecurringSheet from '../components/recurring/RecurringSheet'
import type { Recurring, RecurringItem } from '../components/recurring/types'

const item = (over: Partial<RecurringItem> & Pick<RecurringItem, 'key' | 'name' | 'amount_cents' | 'last_date' | 'state'>): RecurringItem => ({
  category_name: 'Utilities', category_type: 'needs', cadence: 'monthly', next_date: null, remaining: 0,
  price_change: null, history: [{ date: over.last_date, amount_cents: over.amount_cents }], ...over,
})

const mortgage = item({ key: 'hypotheek ing', name: 'Hypotheek ING', amount_cents: 185000, last_date: '2026-10-26', next_date: '2026-11-26', state: 'paid' })
const energy = item({ key: 'vattenfall energie', name: 'Vattenfall energie', amount_cents: 9250, last_date: '2026-10-27', next_date: '2026-11-27', state: 'paid' })
const insurance = item({ key: 'zilveren kruis', name: 'Zilveren Kruis zorgverzekering', amount_cents: 13400, last_date: '2026-10-28', next_date: '2026-11-28', state: 'paid' })
const netflix = item({
  key: 'netflix', name: 'Netflix', amount_cents: 1999, last_date: '2026-11-01', next_date: '2026-12-01', state: 'paid',
  price_change: { from_cents: 1799, to_cents: 1999 },
  history: [
    { date: '2026-11-01', amount_cents: 1999 }, { date: '2026-10-01', amount_cents: 1799 },
    { date: '2026-09-01', amount_cents: 1799 }, { date: '2026-08-01', amount_cents: 1799 },
  ],
})
const ziggo = item({ key: 'ziggo internet', name: 'Ziggo internet', amount_cents: 4500, last_date: '2026-10-12', next_date: '2026-11-12', state: 'due', remaining: 1 })
const basicFit = item({ key: 'basic-fit abonnement', name: 'Basic-Fit abonnement', amount_cents: 2999, last_date: '2026-10-15', next_date: '2026-11-15', state: 'due', remaining: 1 })
const disney = item({ key: 'disney plus', name: 'Disney Plus', amount_cents: 1199, last_date: '2026-08-28', state: 'stopped', category_type: 'wants' })

const base: Recurring = {
  month: '2026-11', start_date: '2026-10-24', end_date: '2026-11-23', today: '2026-11-09', data_through: '2026-11-08',
  status: 'ok', due_cents: 0, expected_cents: 0, items: [],
}

const normal: Recurring = { ...base, due_cents: 7499, items: [ziggo, basicFit, mortgage, energy, insurance, netflix, disney] }
const quiet: Recurring = { ...base, items: [mortgage, energy, insurance, netflix] }
const gap: Recurring = {
  ...base, status: 'gap', data_through: '2026-10-28', expected_cents: 4500,
  items: [{ ...ziggo, state: 'expected' }, mortgage, disney],
}
const none: Recurring = { ...base, status: 'none', items: [] }

const show = (data = normal, onClose = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><RecurringSheet data={data} onClose={onClose} /></QueryClientProvider>)
  return onClose
}

describe('RecurringSheet', () => {
  it('says what is still to pay, then the groups', () => {
    show()
    const dialog = screen.getByRole('dialog', { name: 'Recurring payments' })
    expect(within(dialog).getByText('€75 still to pay')).toBeInTheDocument()
    expect(within(dialog).getByText('Two payments before 23 Nov. Everything else this month is already paid.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Still to pay', 'Paid this month', 'Stopped?'])
    expect(within(dialog).getByRole('button', { name: /Ziggo internet/ })).toHaveTextContent('12 Nov · in 3 days · monthly')
    expect(within(dialog).getByRole('button', { name: /Ziggo internet/ })).toHaveTextContent('€45,00')
  })

  it('flags a price rise and opens a row to the last payments', async () => {
    show()
    const row = screen.getByRole('button', { name: /Netflix/ })
    expect(row).toHaveTextContent('Paid 1 Nov')
    expect(row).toHaveTextContent('Up €2,00')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    const history = screen.getByRole('region', { name: 'Last payments, Netflix' })
    expect(within(history).getAllByText(/€/).map(e => e.textContent)).toEqual(['€19,99', '€17,99', '€17,99', '€17,99'])
    await userEvent.click(row)
    expect(screen.queryByRole('region', { name: 'Last payments, Netflix' })).toBeNull()
  })

  it('names the first payments of next month and what has stopped', () => {
    show()
    expect(screen.getByText(/From 24 Nov: Hypotheek ING, Vattenfall energie and Zilveren Kruis zorgverzekering, €2\.077 in three days\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Disney Plus/ })).toHaveTextContent('Last paid 28 Aug')
  })

  it('says so when nothing more is to pay', () => {
    show(quiet)
    expect(screen.getByText('Nothing more to pay')).toBeInTheDocument()
    expect(screen.getByText('Every repeating payment due before 23 Nov is already paid.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Still to pay' })).toBeNull()
  })

  it('never says missed when bank files stop short', () => {
    show(gap)
    expect(screen.getByText("Can't tell yet")).toBeInTheDocument()
    expect(screen.getByText(/Bank files stop on 28 Oct/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ziggo internet/ })).toHaveTextContent('Expected 12 Nov')
    expect(screen.getByRole('heading', { name: 'Paid up to 28 Oct' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Stopped?' })).toBeNull()
    expect(screen.queryByText(/still to pay/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/missed|late|overdue/i)
  })

  it('explains an empty answer', () => {
    show(none)
    expect(screen.getByText('Nothing repeating yet')).toBeInTheDocument()
    expect(screen.getByText(/once the same one has come in three times/)).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })

  it('says when a payment was due and has not been seen', () => {
    const late = { ...normal, items: [{ ...normal.items[0], next_date: '2026-11-05' }] }
    show(late)
    expect(screen.getByRole('button', { name: /Ziggo internet/ })).toHaveTextContent('Was due 5 Nov')
  })

  it('closes with the button, the scrim and Escape, and starts on the close button', async () => {
    const onClose = show()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(document.querySelector('.scrim')!)
    expect(onClose).toHaveBeenCalledTimes(3)
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

const respond = (body: Recurring | number) => {
  const fetchMock = vi.fn(() => Promise.resolve(
    typeof body === 'number'
      ? new Response('{}', { status: body })
      : new Response(JSON.stringify(body), { status: 200 }),
  ))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const showLink = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RecurringLink month="2026-11" /></QueryClientProvider>)
}

describe('RecurringLink', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('asks for its own month and summarises what is still to pay', async () => {
    const fetchMock = respond(normal)
    showLink()
    const link = await screen.findByRole('button', { name: /€75 still to pay/ })
    expect(link).toHaveTextContent('Ziggo 12 Nov, Basic-Fit 15 Nov')
    expect(link).toHaveClass('link-row')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/recurring\?month=2026-11$/), expect.anything())
  })

  it('opens the sheet and gives focus back on close', async () => {
    respond(normal)
    showLink()
    const link = await screen.findByRole('button', { name: /still to pay/ })
    await userEvent.click(link)
    expect(screen.getByRole('dialog', { name: 'Recurring payments' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('goes quiet when everything is paid', async () => {
    respond(quiet)
    showLink()
    const link = await screen.findByRole('button', { name: /Nothing more to pay/ })
    expect(link).toHaveTextContent('Recurring payments · 4 paid this month')
  })

  it.each([['bank files behind', gap], ['nothing repeating', none]])('is hidden when %s', async (_n, data) => {
    const fetchMock = respond(data)
    showLink()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is hidden for a month that is already over', async () => {
    const fetchMock = respond({ ...normal, end_date: '2026-10-23' })
    showLink()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is hidden when the request fails', async () => {
    const fetchMock = respond(500)
    showLink()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
