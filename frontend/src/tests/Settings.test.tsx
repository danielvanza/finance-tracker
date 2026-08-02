import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Settings from '../pages/Settings'

const mockSettings = { financial_month_start_day: '24' }

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(() => Promise.resolve(mockSettings)),
    patchSetting: vi.fn(() => Promise.resolve({ key: 'financial_month_start_day', value: '15' })),
    getCategories: vi.fn(() => Promise.resolve([])),
    getStandingAdjustments: vi.fn(() => Promise.resolve([])),
    createCategory: vi.fn(() => Promise.resolve({})),
    deleteCategory: vi.fn(() => Promise.resolve({})),
    reorderCategories: vi.fn(() => Promise.resolve([])),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('Settings page', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the settings page with start day input', async () => {
    renderWithClient(<Settings />)
    expect(await screen.findByText('Financial Month Start Day')).toBeTruthy()
    const input = await screen.findByRole('spinbutton')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('24')
  })

  it('saves a valid start day value', async () => {
    const { api } = await import('../api')
    renderWithClient(<Settings />)
    const input = await screen.findByRole('spinbutton')
    fireEvent.change(input, { target: { value: '15' } })
    const saveBtn = screen.getByText('Save')
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(api.patchSetting).toHaveBeenCalledWith('financial_month_start_day', '15')
    })
  })

  it('does not save invalid values (0, 29)', async () => {
    const { api } = await import('../api')
    renderWithClient(<Settings />)
    const input = await screen.findByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save'))
    expect(api.patchSetting).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '29' } })
    fireEvent.click(screen.getByText('Save'))
    expect(api.patchSetting).not.toHaveBeenCalled()
  })
})
