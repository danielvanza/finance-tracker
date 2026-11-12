import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BudgetPlanner from '../components/BudgetPlanner'
import { averageSpend, lastMonthFill, planRows, shiftMonth } from '../components/budget/plan'
import type { BudgetRow, Category } from '../types'

const categories: Category[] = [
  { id: 1, name: 'Rent', type: 'needs', sort_order: 1 },
  { id: 2, name: 'Food', type: 'needs', sort_order: 2 },
  { id: 3, name: 'Fun', type: 'wants', sort_order: 3 },
  { id: 4, name: 'Allowance', type: 'wants', sort_order: 4 },
  { id: 5, name: 'Salary', type: 'income', sort_order: 5 },
]
const row = (id: number, category_id: number, planned: number, actual: number, month = '2026-11-01'): BudgetRow => ({
  id, category_id, category_name: categories[category_id - 1].name, category_type: categories[category_id - 1].type,
  month, planned_amount_cents: planned, actual_amount_cents: actual,
})
const month = (base: number, planned: number[], actual: number[]) =>
  [1, 2, 3, 4].map((c, i) => row(base + i, c, planned[i], actual[i]))

const budgets: Record<string, BudgetRow[]> = {
  '2026-11': month(10, [200000, 40000, 20000, 60000], [0, 0, 0, 0]),
  '2026-10': month(20, [190000, 35000, 25000, 60000], [190000, 30000, 10000, 0]),
  '2026-09': month(30, [190000, 35000, 25000, 60000], [190000, 40000, 20000, 0]),
  '2026-08': month(40, [190000, 35000, 25000, 60000], [0, 0, 0, 0]),
}

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getPace: vi.fn(() => Promise.resolve({
        month: '2026-11', current_month: '2026-11', status: 'ok', start_date: '2026-10-24', end_date: '2026-11-23',
        behind_months: ['2026-11'],
      })),
      getCategories: vi.fn(() => Promise.resolve(categories)),
      getBudget: vi.fn((m: string) => Promise.resolve(budgets[m])),
      getDashboard: vi.fn(() => Promise.resolve({ total_income_cents: 400000 })),
      patchBudget: vi.fn(() => Promise.resolve({})),
    },
  }
})

function renderPlanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><BudgetPlanner /></QueryClientProvider>)
}

describe('plan helpers', () => {
  it('shifts months across a year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', -3)).toBe('2026-08')
  })

  it('keeps only planned kinds', () => {
    const rows = planRows([...budgets['2026-11'], row(99, 5, 0, 0)], categories)
    expect(rows.map(r => r.name)).toEqual(['Rent', 'Food', 'Fun', 'Allowance'])
  })

  it('averages only months with spending', () => {
    const rows = planRows(budgets['2026-11'], categories)
    const avg = averageSpend(rows, [budgets['2026-10'], budgets['2026-09'], budgets['2026-08']])
    expect(avg.get(10)).toBe(190000)
    expect(avg.get(11)).toBe(35000)
    expect(avg.get(12)).toBe(15000)
  })

  it('has no average when no month has spending', () => {
    const rows = planRows(budgets['2026-11'], categories)
    expect(averageSpend(rows, [budgets['2026-08']]).size).toBe(0)
  })

  it('fills from last month only for categories it plans', () => {
    const rows = planRows(budgets['2026-11'], categories)
    const fill = lastMonthFill(rows, budgets['2026-10'].slice(0, 2))
    expect([...fill]).toEqual([[10, 190000], [11, 35000]])
  })
})

describe('BudgetPlanner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the balance against last month income and saves nothing until Save plan', async () => {
    const { api } = await import('../api')
    renderPlanner()
    expect(await screen.findByText('€800')).toBeTruthy() // 3.200 planned of 4.000 income
    expect(screen.getByText('left to plan')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save plan' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '2-month average' }))
    expect((screen.getByLabelText('Food planned amount') as HTMLInputElement).value).toBe('350.00')
    expect(api.patchBudget).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(api.patchBudget).toHaveBeenCalledTimes(4))
    expect(api.patchBudget).toHaveBeenCalledWith(10, 190000)
    expect(api.patchBudget).toHaveBeenCalledWith(11, 35000)
    expect(api.patchBudget).toHaveBeenCalledWith(12, 15000)
  })

  it('undoes a fill and blocks saving an invalid amount', async () => {
    renderPlanner()
    const rent = (await screen.findByLabelText('Rent planned amount')) as HTMLInputElement
    fireEvent.change(rent, { target: { value: 'abc' } })
    expect(rent.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'Save plan' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(rent.value).toBe('2000.00')
  })
})
