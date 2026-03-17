import { render, screen, fireEvent } from '@testing-library/react'
import ReviewCard from '../components/ReviewCard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockTx = {
  id: 1, date: '2026-03-12', amount: -34.99, description: 'Bol.com',
  source: 'ing', category_id: 5, category_name: 'Recreation & Entertainment',
  confirmed: false, categorised_by: 'ai', ai_confidence: 0.72,
}

const mockCategories = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 5, name: 'Recreation & Entertainment', type: 'wants', sort_order: 8 },
]

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

test('renders transaction description and amount', () => {
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={vi.fn()} onSkip={vi.fn()} onCreateRule={vi.fn()} />)
  expect(screen.getByText('Bol.com')).toBeInTheDocument()
  expect(screen.getByText(/34.99/)).toBeInTheDocument()
})

test('shows AI suggestion and confidence', () => {
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={vi.fn()} onSkip={vi.fn()} onCreateRule={vi.fn()} />)
  expect(screen.getByText(/72%/)).toBeInTheDocument()
  expect(screen.getAllByText(/Recreation & Entertainment/).length).toBeGreaterThan(0)
})

test('calls onConfirm when confirm button clicked', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} onCreateRule={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, mockTx.category_id)
})
