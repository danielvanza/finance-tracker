import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewCard from '../components/ReviewCard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Category, Transaction } from '../types'

const mockTx: Transaction = {
  id: 1, date: '2026-03-12', amount_cents: -3499, description: 'Bol.com',
  source: 'ing', category_id: 5, category_name: 'Recreation & Entertainment',
  confirmed: false, categorised_by: 'ai', ai_confidence: 0.72,
  is_refund: false, standing_adjustment_id: null, splits: [],
}

const mockCategories: Category[] = [
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

test('calls onConfirm with the decision when confirm button clicked', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} onCreateRule={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: mockTx.category_id, is_refund: false })
})

describe('ReviewCard incoming-money choice', () => {
  const allCategories: Category[] = [
    { id: 1, name: 'Food', type: 'needs', sort_order: 1 },
    { id: 2, name: 'Salary', type: 'income', sort_order: 20 },
    { id: 3, name: 'Fun', type: 'wants', sort_order: 7 },
    { id: 4, name: 'Internal Transfer', type: 'exclude', sort_order: 30 },
  ]

  const expenseTx: Transaction = {
    id: 1, date: '2026-03-01', amount_cents: -4500,
    description: 'Albert Heijn', source: 'ing',
    category_id: 1, category_name: 'Food',
    confirmed: false, categorised_by: 'ai', ai_confidence: 0.85,
    is_refund: false, standing_adjustment_id: null, splits: [],
  }
  const incomeTx: Transaction = {
    id: 2, date: '2026-03-01', amount_cents: 340000,
    description: 'Salaris Maart', source: 'ing',
    category_id: 2, category_name: 'Salary',
    confirmed: false, categorised_by: 'ai', ai_confidence: 0.9,
    is_refund: false, standing_adjustment_id: null, splits: [],
  }

  it('shows only expense categories for negative amount transactions', () => {
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    // No income/refund/transfer choice for outgoing money
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /food/i }))
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionTexts).toContain('Food')
    expect(optionTexts).toContain('Fun')
    expect(optionTexts).not.toContain('Salary')
  })

  it('defaults positive amounts to income categories', () => {
    wrap(
      <ReviewCard
        transaction={incomeTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: 'Income' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /salary/i }))
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionTexts).toContain('Salary')
    expect(optionTexts).not.toContain('Food')
    expect(optionTexts).not.toContain('Fun')
  })

  it('reveals expense categories when marked as refund and confirms with is_refund', () => {
    const onConfirm = vi.fn()
    wrap(
      <ReviewCard
        transaction={incomeTx}
        categories={allCategories}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Refund' }))
    // Category select now offers expense categories, defaulting to the first
    fireEvent.click(screen.getByRole('button', { name: /food/i }))
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionTexts).toContain('Food')
    expect(optionTexts).toContain('Fun')
    expect(optionTexts).not.toContain('Salary')
    // Pick Fun and confirm
    fireEvent.click(screen.getAllByRole('option').find(o => o.textContent === 'Fun')!)
    fireEvent.click(screen.getByRole('button', { name: /confirm refund/i }))
    expect(onConfirm).toHaveBeenCalledWith(incomeTx.id, { category_id: 3, is_refund: true })
  })

  it('selects transfer categories for the transfer kind', () => {
    wrap(
      <ReviewCard
        transaction={incomeTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Transfer' }))
    fireEvent.click(screen.getByRole('button', { name: /internal transfer/i }))
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionTexts).toContain('Internal Transfer')
    expect(optionTexts).not.toContain('Salary')
  })
})

describe('ReviewCard splitting', () => {
  const categories: Category[] = [
    { id: 1, name: 'Food', type: 'needs', sort_order: 1 },
    { id: 3, name: 'Fun', type: 'wants', sort_order: 7 },
  ]
  const expenseTx: Transaction = {
    id: 9, date: '2026-03-01', amount_cents: -25000,
    description: 'Supermarket', source: 'ing',
    category_id: 1, category_name: 'Food',
    confirmed: false, categorised_by: null, ai_confidence: null,
    is_refund: false, standing_adjustment_id: null, splits: [],
  }

  it('confirms a balanced split with signed parts', () => {
    const onConfirm = vi.fn()
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={categories}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /split…/i }))

    const amountInputs = [
      screen.getByLabelText('Split part 1 amount'),
      screen.getByLabelText('Split part 2 amount'),
    ]
    fireEvent.change(amountInputs[0], { target: { value: '125' } })
    fireEvent.change(amountInputs[1], { target: { value: '125' } })

    // Pick categories for both parts
    const selects = screen.getAllByRole('button', { name: /select category/i })
    fireEvent.click(selects[0])
    fireEvent.click(screen.getAllByRole('option').find(o => o.textContent === 'Food')!)
    fireEvent.click(screen.getAllByRole('button', { name: /select category/i })[0])
    fireEvent.click(screen.getAllByRole('option').find(o => o.textContent === 'Fun')!)

    const confirmBtn = screen.getByRole('button', { name: /confirm split/i })
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith(expenseTx.id, {
      is_refund: false,
      splits: [
        { category_id: 1, amount_cents: -12500 },
        { category_id: 3, amount_cents: -12500 },
      ],
    })
  })

  it('disables confirm while the split does not sum to the total', () => {
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={categories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCreateRule={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /split…/i }))
    fireEvent.change(screen.getByLabelText('Split part 1 amount'), { target: { value: '100' } })
    expect(screen.getByRole('button', { name: /confirm split/i })).toBeDisabled()
    expect(screen.getByText(/Remaining: €150,00/)).toBeInTheDocument()
  })
})
