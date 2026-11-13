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
  '2026-12': month(50, [210000, 40000, 20000, 60000], [0, 0, 0, 0]),
}

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getPace: vi.fn((m?: string) => Promise.resolve(m === '2026-12'
        ? { month: '2026-12', current_month: '2026-11', status: 'gap', start_date: '2026-11-24', end_date: '2026-12-23', behind_months: ['2026-11'] }
        : { month: '2026-11', current_month: '2026-11', status: 'ok', start_date: '2026-10-24', end_date: '2026-11-23', behind_months: ['2026-11'] })),
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

  it('keeps a count of changes and what they add up to beside Save plan, and only while something is changed', async () => {
    renderPlanner()
    const rent = (await screen.findByLabelText('Rent planned amount')) as HTMLInputElement
    expect(document.querySelector('.bud-actions.is-bar')).toBeNull()
    fireEvent.change(rent, { target: { value: '2100' } })
    fireEvent.change(screen.getByLabelText('Food planned amount'), { target: { value: '350' } })
    const bar = document.querySelector('.bud-actions.is-bar') as HTMLElement
    expect(bar).toHaveTextContent('2 changes')
    expect(bar).toHaveTextContent('€50 more, November plan')
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Save plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(document.querySelector('.bud-actions.is-bar')).toBeNull()
    fireEvent.change(rent, { target: { value: 'abc' } })
    expect(document.querySelector('.bud-actions.is-bar')).toHaveTextContent('1 amount to fix')
  })

  it('says how many months a save reached, then goes back to the plain list', async () => {
    const { api } = await import('../api')
    vi.mocked(api.patchBudget).mockResolvedValueOnce({ months_changed: 3 }).mockResolvedValue({ months_changed: 2 })
    renderPlanner()
    fireEvent.change(await screen.findByLabelText('Rent planned amount'), { target: { value: '2100' } })
    fireEvent.change(screen.getByLabelText('Food planned amount'), { target: { value: '450' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByText('Saved for 3 months')).toBeInTheDocument()
    expect(document.querySelector('.bud-actions.is-bar')).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Save plan' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('plans next month: its dates, no income to compare, its own rows and the last plan to fill from', async () => {
    const { api } = await import('../api')
    renderPlanner()
    await screen.findByLabelText('Rent planned amount')
    expect(screen.getByRole('button', { name: 'November', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'December' }))
    expect(await screen.findByText(/December plan, 24 Nov to 23 Dec, not started yet/)).toBeInTheDocument()
    expect(await screen.findByText(/November isn't finished yet, so there's no income to compare the plan with/)).toBeInTheDocument()
    expect(screen.queryByText(/income last month/)).toBeNull()
    expect(api.getBudget).toHaveBeenCalledWith('2026-12')
    expect(api.getDashboard).not.toHaveBeenCalledWith('2026-11')
    fireEvent.click(screen.getByRole('button', { name: "November's plan" }))
    expect((screen.getByLabelText('Rent planned amount') as HTMLInputElement).value).toBe('2000.00')
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(api.patchBudget).toHaveBeenCalledWith(50, 200000))
    expect(api.patchBudget).not.toHaveBeenCalledWith(10, expect.anything())
  })

  it('keeps the month still while something is changed', async () => {
    renderPlanner()
    fireEvent.change(await screen.findByLabelText('Rent planned amount'), { target: { value: '2100' } })
    expect((screen.getByRole('button', { name: 'December' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Save or undo to plan another month.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByRole('button', { name: 'December' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
