import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Import from '../pages/Import'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ApiError, api } from '../api'
import { vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, previewImport: vi.fn(), confirmImport: vi.fn(), getPace: vi.fn(() => new Promise(() => {})) } }
})

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)

test('renders source selector and file upload', () => {
  wrap(<Import />)
  // Source is now a button group — check the ING button is present
  expect(screen.getByRole('button', { name: /^ING$/i })).toBeInTheDocument()
  // Other source buttons should also be present
  expect(screen.getByRole('button', { name: /^REVOLUT$/i })).toBeInTheDocument()
})

test('shows preview button after file selected', () => {
  wrap(<Import />)
  const input = screen.getByLabelText(/CSV file/i)
  const file = new File(['test'], 'test.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
})

describe('failed preview', () => {
  it('renders an inline error banner with status and detail', async () => {
    vi.mocked(api.previewImport).mockRejectedValueOnce(
      new ApiError(500, 'Unrecognised date column', 'Unrecognised date column'),
    )
    const user = userEvent.setup()
    wrap(<Import />)
    fireEvent.change(screen.getByLabelText(/CSV file/i), {
      target: { files: [new File(['x'], 'bad.csv', { type: 'text/csv' })] },
    })
    await user.click(screen.getByRole('button', { name: /preview/i }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/500/)
    expect(banner).toHaveTextContent(/Unrecognised date column/)
    expect(screen.queryByRole('button', { name: /preview/i })).toBeEnabled()
    vi.mocked(api.previewImport).mockReset()
  })

  it('renders friendly text for network failure (status 0)', async () => {
    vi.mocked(api.previewImport).mockRejectedValueOnce(new ApiError(0, 'Network error', null))
    const user = userEvent.setup()
    wrap(<Import />)
    fireEvent.change(screen.getByLabelText(/CSV file/i), {
      target: { files: [new File(['x'], 'bad.csv', { type: 'text/csv' })] },
    })
    await user.click(screen.getByRole('button', { name: /preview/i }))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/couldn't reach the server|could not reach the server/i)
    vi.mocked(api.previewImport).mockReset()
  })
})

describe('after a successful import', () => {
  const importFile = async (result: Partial<import('../types').ImportConfirmResponse>) => {
    vi.mocked(api.previewImport).mockResolvedValueOnce({
      rows: [{ date: '2026-11-09', amount_cents: -2340, description: 'Albert Heijn', source: 'ing', import_hash: 'h1', duplicate: false }],
      total: 1,
      duplicates: 0,
    })
    vi.mocked(api.confirmImport).mockResolvedValueOnce({
      imported: 1, skipped_duplicates: 0, categorised_by_rule: 0, categorised_by_ai: 0, uncategorised: 0, ...result,
    })
    const user = userEvent.setup()
    wrap(<Import />)
    fireEvent.change(screen.getByLabelText(/CSV file/i), {
      target: { files: [new File(['x'], 'ok.csv', { type: 'text/csv' })] },
    })
    await user.click(screen.getByRole('button', { name: /preview/i }))
    await user.click(await screen.findByRole('button', { name: /import 1 new transaction/i }))
  }

  it('links to transactions when some need reviewing', async () => {
    await importFile({ categorised_by_ai: 2, uncategorised: 1 })
    expect(await screen.findByRole('link', { name: 'Review 3 transactions' })).toHaveAttribute('href', '/transactions')
  })

  it('links to the month when nothing needs reviewing', async () => {
    await importFile({ categorised_by_rule: 1 })
    expect(await screen.findByRole('link', { name: 'See the month' })).toHaveAttribute('href', '/')
  })
})
