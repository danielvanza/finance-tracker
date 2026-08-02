import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CategoryManager from '../components/CategoryManager'

const mockCategories = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 2, name: 'Utilities', type: 'needs', sort_order: 2 },
  { id: 3, name: 'Recreation & Entertainment', type: 'wants', sort_order: 8 },
]

vi.mock('../api', () => ({
  api: {
    getCategories: vi.fn(() => Promise.resolve(mockCategories)),
    createCategory: vi.fn(() => Promise.resolve({ id: 4, name: 'Pet Care', type: 'needs', sort_order: 3 })),
    patchCategory: vi.fn(() => Promise.resolve({ id: 1, name: 'Groceries', type: 'needs', sort_order: 1 })),
    deleteCategory: vi.fn(() => Promise.resolve({ deleted: 1 })),
    reorderCategories: vi.fn(() => Promise.resolve([])),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('CategoryManager', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders categories grouped by type with correct labels', async () => {
    renderWithClient(<CategoryManager />)
    expect(await screen.findByText('Needs')).toBeTruthy()
    expect(screen.getByText('Wants')).toBeTruthy()
    expect(screen.getByDisplayValue('Food - Essential')).toBeTruthy()
    expect(screen.getByDisplayValue('Utilities')).toBeTruthy()
    expect(screen.getByDisplayValue('Recreation & Entertainment')).toBeTruthy()
  })

  it('adds a category: fills form, submits, calls api and resets', async () => {
    const { api } = await import('../api')
    renderWithClient(<CategoryManager />)
    await screen.findByText('Needs')

    fireEvent.click(screen.getByText('+ Add category'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Pet Care'), { target: { value: 'Pet Care' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => {
      expect(api.createCategory).toHaveBeenCalledWith({ name: 'Pet Care', type: 'needs' })
    })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('e.g. Pet Care')).not.toBeInTheDocument()
    })
  })

  it('shows an inline error and does not call the API when name is blank', async () => {
    const { api } = await import('../api')
    renderWithClient(<CategoryManager />)
    await screen.findByText('Needs')

    fireEvent.click(screen.getByText('+ Add category'))
    fireEvent.click(screen.getByText('Add'))

    expect(await screen.findByText('Name is required')).toBeTruthy()
    expect(api.createCategory).not.toHaveBeenCalled()
  })

  it('renames a category: edits the name input, blurs, calls patchCategory with {name}', async () => {
    const { api } = await import('../api')
    renderWithClient(<CategoryManager />)
    const input = await screen.findByDisplayValue('Food - Essential')
    fireEvent.change(input, { target: { value: 'Groceries' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(api.patchCategory).toHaveBeenCalledWith(1, { name: 'Groceries' })
    })
  })

  it('shows the server duplicate-name error inline when patchCategory resolves with .detail', async () => {
    const { api } = await import('../api')
    vi.mocked(api.patchCategory).mockResolvedValueOnce({ detail: "'Utilities' already exists" })
    renderWithClient(<CategoryManager />)
    const input = await screen.findByDisplayValue('Food - Essential')
    fireEvent.change(input, { target: { value: 'Utilities' } })
    fireEvent.blur(input)

    expect(await screen.findByText("'Utilities' already exists")).toBeTruthy()
  })

  it('shows the server duplicate-name error inline when createCategory resolves with .detail', async () => {
    const { api } = await import('../api')
    vi.mocked(api.createCategory).mockResolvedValueOnce({ detail: "'Utilities' already exists" })
    renderWithClient(<CategoryManager />)
    await screen.findByText('Needs')

    fireEvent.click(screen.getByText('+ Add category'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Pet Care'), { target: { value: 'Utilities' } })
    fireEvent.click(screen.getByText('Add'))

    expect(await screen.findByText("'Utilities' already exists")).toBeTruthy()
  })

  it('deletes a category when confirm is accepted', async () => {
    const { api } = await import('../api')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithClient(<CategoryManager />)
    await screen.findByDisplayValue('Food - Essential')

    fireEvent.click(screen.getByLabelText('Delete Food - Essential'))

    await waitFor(() => {
      expect(api.deleteCategory).toHaveBeenCalledWith(1)
    })
  })

  it('does not call deleteCategory when confirm is declined', async () => {
    const { api } = await import('../api')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithClient(<CategoryManager />)
    await screen.findByDisplayValue('Food - Essential')

    fireEvent.click(screen.getByLabelText('Delete Food - Essential'))

    expect(api.deleteCategory).not.toHaveBeenCalled()
  })

  it('shows the server in-use error inline when deleteCategory resolves with .detail', async () => {
    const { api } = await import('../api')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.deleteCategory).mockResolvedValueOnce({ detail: "Cannot delete 'Food - Essential': in use by 3 transaction(s)." })
    renderWithClient(<CategoryManager />)
    await screen.findByDisplayValue('Food - Essential')

    fireEvent.click(screen.getByLabelText('Delete Food - Essential'))

    expect(await screen.findByText(/Cannot delete 'Food - Essential'/)).toBeTruthy()
  })

  it('reorders within a group via drag-and-drop', async () => {
    const { api } = await import('../api')
    renderWithClient(<CategoryManager />)
    const dragHandle = await screen.findByLabelText('Reorder Utilities')
    const targetInput = screen.getByDisplayValue('Food - Essential')

    const dataTransfer = {}
    fireEvent.dragStart(dragHandle.closest('div')!, { dataTransfer })
    fireEvent.dragOver(targetInput.closest('div')!, { dataTransfer })
    fireEvent.drop(targetInput.closest('div')!, { dataTransfer })

    await waitFor(() => {
      expect(api.reorderCategories).toHaveBeenCalledWith([2, 1])
    })
  })
})
