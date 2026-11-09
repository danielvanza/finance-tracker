import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Import from '../pages/Import'
import { api } from '../api'
import type { ImportConfirmResponse, ImportPreviewRow, Pace } from '../types'

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, previewImport: vi.fn(), confirmImport: vi.fn(), getPace: vi.fn() } }
})

const pace = (last: { ing?: string | null; revolut?: string | null; degiro?: string | null }, extra: Partial<Pace> = {}): Pace =>
  ({
    month: '2026-11', current_month: '2026-11', status: 'ok', today: '2026-11-09', to_review: 0,
    last_import_by_bank: [
      { source: 'ing', last_date: last.ing ?? null },
      { source: 'revolut', last_date: last.revolut ?? null },
      { source: 'degiro', last_date: last.degiro ?? null },
    ],
    ...extra,
  }) as Pace

const row = (date: string, amount_cents: number, description: string, duplicate: boolean): ImportPreviewRow =>
  ({ date, amount_cents, description, source: 'revolut', import_hash: description, duplicate })

const confirmed: ImportConfirmResponse = {
  imported: 14, skipped_duplicates: 3, categorised_by_rule: 10, categorised_by_ai: 3, uncategorised: 1,
}

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><Import /></MemoryRouter></QueryClientProvider>)
}

const pick = (content = 'x', name = 'f.csv') =>
  fireEvent.change(screen.getByLabelText(/CSV file/i), { target: { files: [new File([content], name, { type: 'text/csv' })] } })

beforeEach(() => {
  vi.mocked(api.getPace).mockReset()
  vi.mocked(api.previewImport).mockReset()
  vi.mocked(api.confirmImport).mockReset()
})

describe('the preview', () => {
  const previewWith = async (rows: ImportPreviewRow[], content = 'x') => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ ing: '2026-11-08', revolut: '2026-11-08' }))
    vi.mocked(api.previewImport).mockResolvedValueOnce({ rows, total: rows.length, duplicates: rows.filter(r => r.duplicate).length })
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Last ING row/)
    pick(content)
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    return user
  }

  it('leads with what to do, puts new rows first and folds the ones already in', async () => {
    await previewWith([
      row('2026-11-03', -1099, 'Spotify', true),
      row('2026-11-09', -2340, 'Albert Heijn', false),
      row('2026-11-09', 1850, 'Refund', false),
    ])
    expect(await screen.findByRole('heading', { name: '2 new to add' })).toBeInTheDocument()
    expect(screen.getByText(/1 already in\. The file covers 3 – 9 Nov\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 new transactions' })).toBeEnabled()
    const fold = screen.getByText('Show the 1 row already in').closest('details')!
    expect(fold).not.toHaveAttribute('open')
    expect(within(fold).getByText('Spotify')).toBeInTheDocument()
    expect(within(fold).getByText('already in')).toBeInTheDocument()
    // Amounts never wrap after the minus.
    expect(screen.getAllByText(/^-€|^\+€/).every(c => c.classList.contains('import-amount'))).toBe(true)
  })

  it('says so when everything is already in, and offers another file', async () => {
    await previewWith([row('2026-11-07', -1099, 'Spotify', true), row('2026-11-08', -500, 'Jumbo', true)])
    expect(await screen.findByRole('heading', { name: 'Nothing new in this file' })).toBeInTheDocument()
    expect(screen.getByText(/All 2 rows are already in\. The file covers 7 – 8 Nov and ING already reaches 8 Nov\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^import/i })).not.toBeInTheDocument()
  })

  it('names the bank a file looks like when nothing could be read, and reads it as that bank', async () => {
    const user = await previewWith([], 'Type,Product,Started Date,Completed Date,Description,Amount\n')
    expect(await screen.findByRole('heading', { name: 'No ING rows in this file' })).toBeInTheDocument()
    vi.mocked(api.previewImport).mockResolvedValueOnce({ rows: [row('2026-11-09', -100, 'Etsy', false)], total: 1, duplicates: 0 })
    await user.click(await screen.findByRole('button', { name: 'Read it as Revolut' }))
    expect(api.previewImport).toHaveBeenLastCalledWith('revolut', expect.any(File))
    expect(await screen.findByRole('heading', { name: '1 new to add' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Revolut/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks to check the bank when the file matches none', async () => {
    await previewWith([], 'a,b,c\n')
    expect(await screen.findByRole('heading', { name: 'No ING rows in this file' })).toBeInTheDocument()
    expect(screen.getByText(/Check the bank matches the file/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Read it as/ })).not.toBeInTheDocument()
  })
})

describe('where each bank stands', () => {
  it('shows each last row and chooses the bank furthest behind', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ ing: '2026-11-08', revolut: '2026-10-29' }))
    mount()
    expect(await screen.findByRole('button', { name: 'Revolut 29 Oct' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ING 8 Nov' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'DEGIRO no file' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Last Revolut row: 29 Oct, 11 days ago. Export from 29 Oct to today; rows already in are skipped.')).toBeInTheDocument()
  })

  it('never suggests a bank with no file, and says how far to export from', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ ing: '2026-11-08' }))
    mount()
    expect(await screen.findByRole('button', { name: 'ING 8 Nov' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Last ING row: 8 Nov, yesterday. Export from 8 Nov to today; rows already in are skipped.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'DEGIRO no file' }))
    expect(screen.getByText('No DEGIRO file yet.')).toBeInTheDocument()
  })
})

describe('after an import', () => {
  const importOne = async (before: Pace, after: Pace, ok = confirmed) => {
    vi.mocked(api.getPace).mockResolvedValueOnce(before).mockResolvedValue(after)
    vi.mocked(api.previewImport).mockResolvedValueOnce({ rows: [row('2026-11-09', -100, 'Etsy', false)], total: 1, duplicates: 0 })
    vi.mocked(api.confirmImport).mockResolvedValueOnce(ok)
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Last ING row/)
    pick()
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    await user.click(await screen.findByRole('button', { name: /import 1 new transaction/i }))
    return user
  }
  const FRESH = { ing: '2026-11-08', revolut: '2026-11-08' }

  it('leads with the result, focuses it, drops the steps and refreshes the pace', async () => {
    await importOne(pace(FRESH), pace(FRESH))
    const heading = await screen.findByRole('heading', { name: 'Import finished' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('Added 14 transactions, 3 already in')).toBeInTheDocument()
    expect(screen.getByText(/sorted by your rules,/)).toHaveTextContent('10 rows sorted by your rules, 4 need a look.')
    expect(screen.queryByText(/Choose the bank/)).not.toBeInTheDocument()
    expect(screen.getByText('The full count').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'Review 4 transactions' })).toHaveAttribute('href', '/transactions')
    await waitFor(() => expect(vi.mocked(api.getPace).mock.calls.length).toBeGreaterThan(1))
  })

  it('brings the steps back on request', async () => {
    const user = await importOne(pace(FRESH), pace(FRESH))
    await user.click(await screen.findByRole('button', { name: 'Import another file' }))
    expect(screen.getByText(/Choose the bank/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Import finished' })).not.toBeInTheDocument()
  })

  it('shows what changed and which bank is next', async () => {
    const user = await importOne(
      pace({ ing: '2026-10-28', revolut: '2026-10-29' }),
      pace({ ing: '2026-11-09', revolut: '2026-10-29' }),
    )
    await user.click(await screen.findByRole('button', { name: /Next: Revolut|Import another file/ }))
    expect(
      await screen.findByText('ING now runs to 9 Nov, up from 28 Oct. Revolut is next: its last row is 29 Oct, 11 days ago.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revolut 29 Oct' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('picking up after a gap', () => {
  it('stays out of the way when every bank is within a week', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ ing: '2026-11-08', revolut: '2026-11-03' }))
    mount()
    await screen.findByText(/Last/)
    expect(screen.queryByText('Picking up')).not.toBeInTheDocument()
  })

  it('lists the banks behind, the review and the month', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({ ing: '2026-10-28', revolut: '2026-10-29' }, { status: 'gap', to_review: 12 }))
    mount()
    expect(await screen.findByText('From 28 Oct')).toBeInTheDocument()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps.map(li => li.textContent)).toEqual(['1ING' + 'to 28 Oct', '2Revolutto 29 Oct', '3Review12 to look at', '4The monthwhere you stand'])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/Two banks stop before today/)).toBeInTheDocument()
  })

  it('moves on to the next bank, then to the review', async () => {
    const behind = pace({ ing: '2026-10-28', revolut: '2026-10-29' }, { status: 'gap', to_review: 12 })
    vi.mocked(api.getPace).mockResolvedValue(behind)
    vi.mocked(api.previewImport).mockResolvedValue({ rows: [row('2026-11-09', -100, 'Etsy', false)], total: 1, duplicates: 0 })
    vi.mocked(api.confirmImport).mockResolvedValue(confirmed)
    const user = userEvent.setup()
    mount()
    await screen.findByText('From 28 Oct')
    pick()
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    await user.click(await screen.findByRole('button', { name: /import 1 new transaction/i }))
    expect(await screen.findByRole('heading', { name: 'ING added' })).toBeInTheDocument()
    expect(screen.getByText('One bank to go')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review first' })).toHaveAttribute('href', '/transactions')
    await user.click(screen.getByRole('button', { name: 'Next: Revolut' }))
    expect(screen.getByRole('button', { name: /^Revolut/ })).toHaveAttribute('aria-pressed', 'true')
    pick()
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    await user.click(await screen.findByRole('button', { name: /import 1 new transaction/i }))
    expect(await screen.findByRole('heading', { name: 'Revolut added' })).toBeInTheDocument()
    expect(screen.getByText('Almost there')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 12 transactions' })).toHaveAttribute('href', '/transactions')
  })

  it('says there are no bank files yet instead of guessing', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace({}, { status: 'empty' }))
    mount()
    expect(await screen.findByText('No bank files yet')).toBeInTheDocument()
  })
})
