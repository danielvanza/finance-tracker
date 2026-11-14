import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddTransactionModal from '../components/AddTransactionModal'
import ReviewCard from '../components/ReviewCard'
import { api } from '../api'
import type { Category, Transaction } from '../types'

const categories: Category[] = [{ id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 }]

beforeEach(() => {
  vi.spyOn(api, 'createTransaction').mockResolvedValue({} as Transaction)
})

describe('Add sheet', () => {
  it('saves with Enter in a field and closes', async () => {
    const onClose = vi.fn()
    render(<AddTransactionModal categories={categories} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bread' } })
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Select category/ }))
    fireEvent.click(await screen.findByRole('option', { name: /Food - Essential/ }))
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.createTransaction).toHaveBeenCalledTimes(1)
  })

  it('Save and add another keeps the sheet, date and clears amount and description', async () => {
    const onClose = vi.fn()
    render(<AddTransactionModal categories={categories} onClose={onClose} onSaved={vi.fn()} />)
    const date = (screen.getByLabelText('Date') as HTMLInputElement).value
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bread' } })
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Select category/ }))
    fireEvent.click(await screen.findByRole('option', { name: /Food - Essential/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and add another' }))
    await waitFor(() => expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe(''))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(date)
    expect(document.activeElement).toBe(screen.getByLabelText('Description'))
  })
})

test('a review card asked to focus puts focus on its category control', () => {
  const tx: Transaction = {
    id: 1, date: '2026-03-12', amount_cents: -100, description: 'Shop', source: 'ing', category_id: null, category_name: null,
    confirmed: false, categorised_by: null, ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
  }
  render(<ReviewCard transaction={tx} categories={categories} onConfirm={vi.fn()} onSkip={vi.fn()} focusCategory />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Select category/ }))
})
