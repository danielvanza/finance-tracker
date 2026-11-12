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

/** The pace as the Import page reads it: how far the ING data runs. */
const pace = (last: string | null, extra: Partial<Pace> = {}): Pace =>
  ({
    month: '2026-11', current_month: '2026-11', status: 'ok', today: '2026-11-09', to_review: 0,
    newest_bank_date: last, last_import_by_bank: [{ source: 'ing', last_date: last }],
    ...extra,
  }) as Pace

const row = (date: string, amount_cents: number, description: string, duplicate: boolean): ImportPreviewRow =>
  ({ date, amount_cents, description, source: 'ing', import_hash: description, duplicate })

const confirmed: ImportConfirmResponse = {
  imported: 14, skipped_duplicates: 3, categorised_by_rule: 7, categorised_by_ai: 3, doubtful: 3, uncategorised: 1,
}

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><Import /></MemoryRouter></QueryClientProvider>)
}

const pick = (content = 'x', name = 'f.csv') =>
  fireEvent.change(screen.getByLabelText(/ING file/i), { target: { files: [new File([content], name, { type: 'text/csv' })] } })

beforeEach(() => {
  vi.mocked(api.getPace).mockReset()
  vi.mocked(api.previewImport).mockReset()
  vi.mocked(api.confirmImport).mockReset()
})

describe('the preview', () => {
  const previewWith = async (rows: ImportPreviewRow[], content = 'x') => {
    vi.mocked(api.getPace).mockResolvedValue(pace('2026-11-08'))
    vi.mocked(api.previewImport).mockResolvedValueOnce({ rows, total: rows.length, duplicates: rows.filter(r => r.duplicate).length })
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Bank data runs to/)
    pick(content)
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    return user
  }

  it('says how far the bank data runs, and that rows already in are skipped', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace('2026-11-08'))
    mount()
    expect(await screen.findByText(/Bank data runs to/)).toHaveTextContent('Bank data runs to 8 Nov; rows already in are skipped.')
  })

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
    expect(api.previewImport).toHaveBeenLastCalledWith(expect.any(File))
  })

  it('says so when everything is already in, and offers another file', async () => {
    await previewWith([row('2026-11-07', -1099, 'Spotify', true), row('2026-11-08', -500, 'Jumbo', true)])
    expect(await screen.findByRole('heading', { name: 'Nothing new in this file' })).toBeInTheDocument()
    expect(screen.getByText(/All 2 rows are already in\. The file covers 7 – 8 Nov and ING already reaches 8 Nov\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^import/i })).not.toBeInTheDocument()
  })

  it('says a file that is not an ING export is not one, and offers no other bank', async () => {
    await previewWith([], 'Type,Product,Started Date,Completed Date,Description,Amount\n')
    expect(await screen.findByRole('heading', { name: 'No ING rows in this file' })).toBeInTheDocument()
    expect(await screen.findByText(/This does not look like an ING export\. Only ING files can be imported\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Read it as/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeEnabled()
  })

  it('says an ING file with no payments in it has none, in English or Dutch', async () => {
    await previewWith([], '"Datum";"Naam / Omschrijving";"Rekening"\n')
    expect(await screen.findByRole('heading', { name: 'No ING rows in this file' })).toBeInTheDocument()
    expect(await screen.findByText(/The file has the right columns but no payments in it\./)).toBeInTheDocument()
  })
})

describe('after an import', () => {
  const importOne = async (before: Pace, after: Pace, ok = confirmed) => {
    vi.mocked(api.getPace).mockResolvedValueOnce(before).mockResolvedValue(after)
    vi.mocked(api.previewImport).mockResolvedValueOnce({ rows: [row('2026-11-09', -100, 'Etsy', false)], total: 1, duplicates: 0 })
    vi.mocked(api.confirmImport).mockResolvedValueOnce(ok)
    const user = userEvent.setup()
    mount()
    await screen.findByText(/Bank data runs to/)
    pick()
    await user.click(screen.getByRole('button', { name: /preview import/i }))
    await user.click(await screen.findByRole('button', { name: /import 1 new transaction/i }))
    return user
  }

  it('leads with the result, focuses it, drops the file step and refreshes the pace', async () => {
    await importOne(pace('2026-11-08'), pace('2026-11-09'))
    const heading = await screen.findByRole('heading', { name: 'Import finished' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('Added 14 transactions, 3 already in')).toBeInTheDocument()
    expect(screen.getByText(/sorted and counted,/)).toHaveTextContent('10 rows sorted and counted, 4 need your answer.')
    expect(screen.queryByLabelText(/ING file/i)).not.toBeInTheDocument()
    expect(screen.getByText('The full count').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'Review 4 transactions' })).toHaveAttribute('href', '/transactions')
    await waitFor(() => expect(vi.mocked(api.getPace).mock.calls.length).toBeGreaterThan(1))
    expect(api.confirmImport).toHaveBeenLastCalledWith(expect.any(File))
  })

  it('brings the file step back on request', async () => {
    const user = await importOne(pace('2026-11-08'), pace('2026-11-09'))
    await user.click(await screen.findByRole('button', { name: 'Import another file' }))
    expect(screen.getByLabelText(/ING file/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Import finished' })).not.toBeInTheDocument()
  })
})

describe('picking up after a gap', () => {
  it('stays out of the way when the bank data is within a week', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace('2026-11-03'))
    mount()
    await screen.findByText(/Bank data runs to/)
    expect(screen.queryByText('Picking up')).not.toBeInTheDocument()
  })

  it('lists the bank behind, the review and the month', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace('2026-10-28', { status: 'gap', to_review: 12 }))
    mount()
    expect(await screen.findByText('From 28 Oct')).toBeInTheDocument()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps.map(li => li.textContent)).toEqual(['1ING' + 'to 28 Oct', '2Review12 to look at', '3The monthwhere you stand'])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/One bank stops before today/)).toBeInTheDocument()
  })

  it('moves on to the review once the file is in', async () => {
    const behind = pace('2026-10-28', { status: 'gap', to_review: 12 })
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
    expect(screen.getByText('Almost there')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 12 transactions' })).toHaveAttribute('href', '/transactions')
  })

  it('says there are no bank files yet instead of guessing', async () => {
    vi.mocked(api.getPace).mockResolvedValue(pace(null, { status: 'empty' }))
    mount()
    expect(await screen.findByText('No bank files yet')).toBeInTheDocument()
  })
})
