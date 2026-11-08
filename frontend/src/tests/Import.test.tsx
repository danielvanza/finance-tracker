import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Import from '../pages/Import'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, api } from '../api'
import { vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, previewImport: vi.fn() } }
})

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

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
