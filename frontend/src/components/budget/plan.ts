import type { BudgetRow, Category } from '../../types'

export type PlanKind = 'needs' | 'wants' | 'savings'

export const KINDS: { kind: PlanKind; label: string }[] = [
  { kind: 'needs', label: 'Needs' },
  { kind: 'wants', label: 'Wants' },
  { kind: 'savings', label: 'Savings' },
]

/** The household's target split ("60/25/15": needs, wants, savings, as shares of income). 50/30/20 until it is set. */
export function parseSplit(value: string | undefined): [number, number, number] {
  const parts = (value ?? '').split('/').map(Number)
  return parts.length === 3 && parts.every(n => Number.isInteger(n) && n >= 0) && parts[0] + parts[1] + parts[2] === 100
    ? [parts[0], parts[1], parts[2]]
    : [50, 30, 20]
}

export function aimsOf(value: string | undefined): Record<PlanKind, number> {
  const [needs, wants, savings] = parseSplit(value)
  return { needs, wants, savings }
}

export function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface PlanRow {
  id: number
  categoryId: number
  name: string
  kind: PlanKind
  savedCents: number
}

const isKind = (t: string | undefined): t is PlanKind => t === 'needs' || t === 'wants' || t === 'savings'

/** This month's budget rows for the three planned kinds, in the order categories are kept. */
export function planRows(budget: BudgetRow[], categories: Category[]): PlanRow[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const rows: (PlanRow & { order: number })[] = []
  for (const b of budget) {
    const cat = byId.get(b.category_id)
    const kind = b.category_type ?? cat?.type
    if (!isKind(kind)) continue
    rows.push({
      id: b.id, categoryId: b.category_id, name: b.category_name, kind,
      savedCents: b.planned_amount_cents, order: cat?.sort_order ?? 0,
    })
  }
  return rows.sort((a, b) => a.order - b.order)
}

/** Last month's plan per category. Categories it doesn't mention keep their value. */
export function lastMonthFill(rows: PlanRow[], lastBudget: BudgetRow[]): Map<number, number> {
  const last = new Map(lastBudget.map(b => [b.category_id, b.planned_amount_cents]))
  const fill = new Map<number, number>()
  for (const r of rows) {
    const v = last.get(r.categoryId)
    if (v !== undefined) fill.set(r.id, v)
  }
  return fill
}

/**
 * What each category really spent per finished month, averaged, to whole euros.
 * Only months with any spending count (an empty month would drag every average down).
 */
export function averageSpend(rows: PlanRow[], months: BudgetRow[][]): Map<number, number> {
  const withData = months.filter(m => m.some(b => (b.actual_amount_cents ?? 0) !== 0))
  const avg = new Map<number, number>()
  if (withData.length === 0) return avg
  for (const r of rows) {
    const sum = withData.reduce((s, m) => {
      const b = m.find(x => x.category_id === r.categoryId)
      return s + Math.max(0, b?.actual_amount_cents ?? 0)
    }, 0)
    avg.set(r.id, Math.round(sum / withData.length / 100) * 100)
  }
  return avg
}
