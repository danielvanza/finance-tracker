import { api } from '../../api'
import type { Category, Transaction } from '../../types'

/** What a bulk action did: rows saved, rows still ticked, and a plain sentence for each reason a row was left. */
export interface BulkOutcome {
  done: number[]
  left: number[]
  notes: string[]
}

async function settle(rows: Transaction[], job: (tx: Transaction) => Promise<unknown>): Promise<{ ok: number[]; failed: number[] }> {
  const results = await Promise.allSettled(rows.map(job))
  const ok: number[] = []
  const failed: number[] = []
  results.forEach((r, i) => (r.status === 'fulfilled' ? ok : failed).push(rows[i].id))
  return { ok, failed }
}

/** Confirm with the category each row already has. Rows with none yet are left for Category. No bulk endpoint: one PATCH per row. */
export async function confirmRows(rows: Transaction[]): Promise<BulkOutcome> {
  const ready = rows.filter(t => t.category_id != null || t.splits.length > 0)
  const bare = rows.filter(t => !ready.includes(t))
  const { ok, failed } = await settle(ready, t =>
    api.patchTransaction(t.id, t.splits.length > 0 ? { confirmed: true } : { category_id: t.category_id!, confirmed: true }))
  const notes = bare.length > 0 ? [`${bare.length} ${bare.length === 1 ? 'has' : 'have'} no category yet: choose one with Category.`] : []
  return { done: ok, left: [...failed, ...bare.map(t => t.id)], notes }
}

/** Set one category and confirm. Money coming in under a spending category is a refund, as in the review card. Split rows are left alone. */
export async function categoriseRows(rows: Transaction[], category: Category): Promise<BulkOutcome> {
  const plain = rows.filter(t => t.splits.length === 0)
  const split = rows.filter(t => t.splits.length > 0)
  const { ok, failed } = await settle(plain, t =>
    api.patchTransaction(t.id, {
      category_id: category.id,
      is_refund: t.amount_cents > 0 && ['needs', 'wants', 'savings'].includes(category.type),
      confirmed: true,
    }))
  const notes = split.length > 0 ? [`${split.length} ${split.length === 1 ? 'is' : 'are'} split: change those with Split.`] : []
  return { done: ok, left: [...failed, ...split.map(t => t.id)], notes }
}

export async function deleteRows(rows: Transaction[]): Promise<BulkOutcome> {
  const { ok, failed } = await settle(rows, t => api.deleteTransaction(t.id))
  return { done: ok, left: failed, notes: [] }
}

/** The banner for a partly failed action; null when every row was saved. */
export function describeOutcome(total: number, o: BulkOutcome): { title: string; message: string } | null {
  if (o.left.length === 0) return null
  const left = o.left.length
  return {
    title: `${o.done.length} of ${total} saved`,
    message: [`The other ${left} didn't save and ${left === 1 ? 'is' : 'are'} still selected.`, ...o.notes, 'Try again.'].join(' '),
  }
}
