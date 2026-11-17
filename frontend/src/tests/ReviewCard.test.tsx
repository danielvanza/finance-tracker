import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import ReviewCard from '../components/ReviewCard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Category, ReviewTransaction, Transaction } from '../types'

const mockTx: Transaction = {
  id: 1, date: '2026-03-12', amount_cents: -3499, description: 'Bol.com',
  source: 'ing', category_id: 5, category_name: 'Recreation & Entertainment',
  confirmed: false, categorised_by: 'ai', ai_confidence: 0.72,
  is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
}

const mockCategories: Category[] = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 5, name: 'Recreation & Entertainment', type: 'wants', sort_order: 8 },
]

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

const withOptions: ReviewTransaction = {
  ...mockTx,
  options: [
    { category_id: 5, label: 'Recreation & Entertainment', refund: false },
    { category_id: 1, label: 'Food - Essential', refund: false },
  ],
}

test('renders transaction description and amount', () => {
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={vi.fn()} onSkip={vi.fn()} />)
  expect(screen.getByText('Bol.com')).toBeInTheDocument()
  expect(screen.getByLabelText('€34,99')).toBeInTheDocument()
})

test('offers the likely categories as one tap each, Claude\'s guess first', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={withOptions} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  expect(screen.getByText(/Claude wasn’t sure/)).toBeInTheDocument()
  const choices = within(screen.getByRole('group', { name: /Which is it/ })).getAllByRole('button')
  expect(choices.map(c => c.textContent)).toEqual(['Recreation & EntertainmentClaude’s guess1', 'Food - Essential2'])
  fireEvent.click(choices[1])
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 1, is_refund: false })
})

test('offers Claude\'s one guess when the server sends no options', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /^Recreation & Entertainment/ }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 5, is_refund: false })
})

test('remembers the shop only when the switch is on', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={withOptions} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  const remember = screen.getByRole('switch', { name: /^Remember .+ for next time$/ })
  expect(remember).not.toBeChecked()
  fireEvent.click(remember)
  fireEvent.click(screen.getByRole('button', { name: /^Food - Essential/ }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 1, is_refund: false, remember: true })
})

test('a refund option answers as a refund and makes no rule', () => {
  const onConfirm = vi.fn()
  const back: ReviewTransaction = { ...mockTx, amount_cents: 1200, options: [{ category_id: 5, label: 'Refund: Recreation & Entertainment', refund: true }] }
  wrap(<ReviewCard transaction={back} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: /^Refund: Recreation/ }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 5, is_refund: true })
})

test('answers with 1 to 3 and skips with S, but not while typing', () => {
  const onConfirm = vi.fn()
  const onSkip = vi.fn()
  wrap(<><input aria-label="elsewhere" /><ReviewCard transaction={withOptions} categories={mockCategories} onConfirm={onConfirm} onSkip={onSkip} /></>)
  fireEvent.keyDown(screen.getByLabelText('elsewhere'), { key: '2' })
  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: 's' })
  expect(onSkip).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(document.body, { key: '2' })
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 1, is_refund: false })
})

test('holds the chosen answer while it saves, and frees the card if it is refused', async () => {
  let refuse: () => void = () => {}
  const onConfirm = vi.fn(() => new Promise<void>((_, reject) => { refuse = () => reject(new Error('no')) }))
  wrap(<ReviewCard transaction={withOptions} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /^Food - Essential/ }))
  expect(screen.getByRole('button', { name: /^Food - Essential/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /^Recreation/ }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  refuse()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Food - Essential/ })).toBeEnabled())
})

test('Something else opens the full picker and confirms from it', () => {
  const onConfirm = vi.fn()
  wrap(<ReviewCard transaction={withOptions} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('group', { name: /Which is it/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
  fireEvent.click(screen.getByRole('button', { name: /confirm category/i }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, { category_id: 5, is_refund: false })
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
    is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
  }
  const incomeTx: Transaction = {
    id: 2, date: '2026-03-01', amount_cents: 340000,
    description: 'Salaris Maart', source: 'ing',
    category_id: 2, category_name: 'Salary',
    confirmed: false, categorised_by: 'ai', ai_confidence: 0.9,
    is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
  }

  it('shows only expense categories for negative amount transactions', () => {
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={allCategories}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Something else…' }))
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
    is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
  }

  it('confirms a balanced split with signed parts', () => {
    const onConfirm = vi.fn()
    wrap(
      <ReviewCard
        transaction={expenseTx}
        categories={categories}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

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
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    fireEvent.change(screen.getByLabelText('Split part 1 amount'), { target: { value: '100' } })
    expect(screen.getByRole('button', { name: /confirm split/i })).toBeDisabled()
    expect(screen.getByText(/Remaining: €150,00/)).toBeInTheDocument()
  })
})
