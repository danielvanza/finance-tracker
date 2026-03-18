import { describe, it, expect, vi } from 'vitest'
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

describe('ReviewCard sign-filtering', () => {
  const allCategories = [
    { id: 1, name: 'Food', type: 'needs', sort_order: 1 },
    { id: 2, name: 'Salary', type: 'income', sort_order: 20 },
    { id: 3, name: 'Fun', type: 'wants', sort_order: 7 },
  ]

  it('shows only expense categories for negative amount transactions', () => {
    const expenseTx = {
      id: 1, date: '2026-03-01', amount: -45.0,
      description: 'Albert Heijn', source: 'ing',
      category_id: 1, category_name: 'Food',
      confirmed: false, categorised_by: 'ai', ai_confidence: 0.85,
    }
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    const options = screen.getAllByRole('option')
    const optionTexts = options.map(o => o.textContent)
    expect(optionTexts).toContain('Food')
    expect(optionTexts).toContain('Fun')
    expect(optionTexts).not.toContain('Salary')
  })

  it('shows only income categories for positive amount transactions', () => {
    const incomeTx = {
      id: 2, date: '2026-03-01', amount: 3400.0,
      description: 'Salaris Maart', source: 'ing',
      category_id: 2, category_name: 'Salary',
      confirmed: false, categorised_by: 'ai', ai_confidence: 0.9,
    }
    wrap(
      <ReviewCard
        transaction={incomeTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    const options = screen.getAllByRole('option')
    const optionTexts = options.map(o => o.textContent)
    expect(optionTexts).toContain('Salary')
    expect(optionTexts).not.toContain('Food')
    expect(optionTexts).not.toContain('Fun')
  })
})
