import { Check, Plus, X } from 'lucide-react'
import type { Category } from '../types'
import { parseToCents, centsToInputString, formatCents, sumCents } from '../money'
import CategorySelect from './CategorySelect'

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

interface Props {
  totalAmount: number // signed parent amount in cents
  categories: Category[]
  rows: SplitRow[]
  onChange: (rows: SplitRow[]) => void
  /** Display-only flags parallel to rows; marks parts that net against their category */
  seededRefunds?: boolean[]
}

export default function SplitEditor({ totalAmount, categories, rows, onChange, seededRefunds }: Props) {
  const remaining = Math.abs(totalAmount) - splitRowsTotalCents(rows)
  const balanced = remaining === 0

  const update = (idx: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const assignRemaining = () => {
    if (remaining <= 0 || rows.length === 0) return
    const idx = rows.length - 1
    const next = (parseToCents(rows[idx].amount) ?? 0) + remaining
    update(idx, { amount: centsToInputString(next) })
  }

  return (
    <div>
      {rows.map((row, idx) => (
        <div key={idx} className="split-row">
          <CategorySelect
            categories={categories}
            value={row.category_id}
            onChange={id => update(idx, { category_id: id })}
            compact
          />
          <div className="split-amount">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="field field-num"
              value={row.amount}
              onChange={e => update(idx, { amount: e.target.value })}
              placeholder="0.00"
              aria-label={`Split part ${idx + 1} amount`}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-danger split-remove"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            disabled={rows.length <= 2}
            aria-label={`Remove split part ${idx + 1}`}
          >
            <X size={15} aria-hidden="true" />
          </button>
          {seededRefunds?.[idx] && (
            <span className="tx-tag split-refund" title="This part nets against its category (refund)">refund</span>
          )}
        </div>
      ))}

      <div className="split-foot">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange([...rows, { category_id: null, amount: '' }])}
        >
          <Plus size={14} aria-hidden="true" />
          Add part
        </button>
        <button
          type="button"
          className={`btn btn-sm num split-balance${balanced ? ' is-balanced' : remaining < 0 ? ' is-over' : ''}`}
          onClick={assignRemaining}
          disabled={balanced}
          title={balanced ? undefined : 'Assign the remaining amount to the last part'}
        >
          {balanced && <Check size={14} aria-hidden="true" />}
          {balanced ? 'Balanced' : `Remaining: ${formatCents(remaining)}`}
        </button>
      </div>
    </div>
  )
}
