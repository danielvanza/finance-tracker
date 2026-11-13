import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CommandPalette from '../components/shell/CommandPalette'
import { PLACES } from '../components/shell/keys'
import { SETUP_SECTIONS } from '../pages/setup/sections'

vi.mock('../api', () => ({
  api: {
    getTransactions: vi.fn(() => Promise.resolve([])),
    getPace: vi.fn(() => Promise.resolve({ to_review: 0 })),
  },
  ApiError: class extends Error {},
}))

function Where() {
  const { pathname, search, hash } = useLocation()
  return <p data-testid="where">{pathname + search + hash}</p>
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CommandPalette onClose={() => {}} onAdd={() => {}} /><Where /></MemoryRouter>
    </QueryClientProvider>,
  )
  return screen.getByRole('combobox')
}

describe('Find places', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists no places until something is typed', () => {
    show()
    expect(screen.queryByText('Places')).not.toBeInTheDocument()
    expect(screen.getByText('Go to')).toBeInTheDocument()
  })

  it.each([
    ['start day', 'Financial month start day', '/setup#month-start'],
    ['target split', 'Target split', '/setup#target-split'],
    ['export', 'Your data', '/setup#your-data'],
    ['report', 'Month report', '/report'],
    ['recurring', 'Recurring payments', '/'],
  ])('finds "%s" and opens it where it lives', (typed, label, to) => {
    const box = show()
    fireEvent.change(box, { target: { value: typed } })
    expect(screen.getByText('Places')).toBeInTheDocument()
    const hit = screen.getByRole('option', { name: new RegExp(label) })
    expect(hit).toHaveTextContent(/Setup|Month/)
    fireEvent.click(hit)
    expect(screen.getByTestId('where')).toHaveTextContent(to)
  })

  it('still says so when nothing matches, now naming settings', async () => {
    fireEvent.change(show(), { target: { value: 'xyzzy' } })
    expect(await screen.findByText(/a setting/)).toBeInTheDocument()
  })

  it('only links to Setup sections that exist there', () => {
    const ids = new Set(SETUP_SECTIONS.map(s => s.id))
    for (const place of PLACES.filter(p => p.to.startsWith('/setup#'))) {
      expect(ids.has(place.to.split('#')[1])).toBe(true)
    }
  })
})
