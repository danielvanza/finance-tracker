import { parseToCents, sumCents } from '../money'

export interface SplitRow {
  category_id: number | null
  amount: string // positive magnitude as typed by the user
}

export function splitRowsTotalCents(rows: SplitRow[]): number {
  return sumCents(rows.map(r => parseToCents(r.amount) ?? 0))
}

export function splitRowsValid(rows: SplitRow[], totalAmountCents: number): boolean {
  if (rows.length < 2) return false
  if (rows.some(r => r.category_id == null)) return false
  if (rows.some(r => { const c = parseToCents(r.amount); return c == null || c <= 0 })) return false
  // Exact integer comparison — magnitudes must sum to the parent's magnitude
  return sumCents(rows.map(r => Math.abs(parseToCents(r.amount) ?? 0))) === Math.abs(totalAmountCents)
}
