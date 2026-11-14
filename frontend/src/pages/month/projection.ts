import type { Pace, Transaction } from '../../types'

/** Before this many days have passed there is too little to say where anything is heading. */
const EARLY_DAYS = 5

/** Whole days of the month that are over and covered by the bank files, or null while it is too early or unknown. */
export function elapsedShare(p: Pace): number | null {
  if (p.status !== 'ok' || p.day_number === null || p.day_number <= EARLY_DAYS) return null
  return (p.day_number - 1) / p.days_total
}

const tens = (cents: number) => Math.round(cents / 1000) * 1000

/** How many payments each category took this month: refunds are not payments, a split counts for each part's category. */
export function paymentsByCategory(txs: Transaction[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const tx of txs) {
    const parts = tx.splits.length > 0
      ? tx.splits.map(s => ({ id: s.category_id, amount: s.amount_cents, refund: s.is_refund ?? tx.is_refund }))
      : [{ id: tx.category_id, amount: tx.amount_cents, refund: tx.is_refund }]
    for (const part of parts) {
      if (part.id !== null && part.amount < 0 && !part.refund) counts[part.id] = (counts[part.id] ?? 0) + 1
    }
  }
  return counts
}

export type CategoryStatus =
  | { kind: 'paid' }
  | { kind: 'ahead'; endCents: number; overCents: number }

/**
 * Words for a row that its bar and tick leave you to work out. Over plan is already said by the row itself.
 * Paid: nearly all of the plan went in one or two payments. Ahead: well past the share of the month
 * gone, at least two payments, and on course to finish above plan.
 */
export function categoryStatus(
  actual: number, planned: number, payments: number, elapsed: number | null,
): CategoryStatus | null {
  if (planned <= 0 || actual > planned) return null
  if (payments >= 1 && payments <= 2 && actual >= planned * 0.9) return { kind: 'paid' }
  if (elapsed === null || payments < 2) return null
  const end = actual / elapsed
  if (actual / planned > elapsed + 0.15 && end > planned) {
    return { kind: 'ahead', endCents: tens(end), overCents: tens(end - planned) }
  }
  return null
}
