import { formatCents } from '../../money'
import type { Transaction } from '../../types'

export interface ListFilters {
  q: string
  needsReview: boolean
  thisMonth: boolean
  categoryId: number | null
  source: string
  over100: boolean
}

/** The current financial month's first and last day, from the pace endpoint (never the calendar). */
export interface MonthRange {
  start: string
  end: string
}

export const OVER_CENTS = 10000

/** Everything a search can match: description, categories (and split categories), the amount as shown and as typed. */
function haystack(tx: Transaction): string {
  const abs = Math.abs(tx.amount_cents)
  return [
    tx.description,
    tx.category_name ?? '',
    ...tx.splits.map(s => s.category_name ?? ''),
    formatCents(abs),
    (abs / 100).toFixed(2),
  ].join(' ').toLowerCase()
}

export function matchesQuery(tx: Transaction, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack(tx)
  return tokens.every(t => text.includes(t))
}

export function filterTransactions(list: Transaction[], f: ListFilters, month: MonthRange | null): Transaction[] {
  return list.filter(tx => {
    if (f.needsReview && tx.confirmed) return false
    if (f.thisMonth && month && (tx.date < month.start || tx.date > month.end)) return false
    if (f.categoryId != null && tx.category_id !== f.categoryId && !tx.splits.some(s => s.category_id === f.categoryId)) return false
    if (f.source !== 'all' && tx.source !== f.source) return false
    if (f.over100 && Math.abs(tx.amount_cents) <= OVER_CENTS) return false
    return matchesQuery(tx, f.q)
  })
}

export const hasFilters = (f: ListFilters) =>
  f.q.trim() !== '' || f.needsReview || f.thisMonth || f.categoryId != null || f.source !== 'all' || f.over100
