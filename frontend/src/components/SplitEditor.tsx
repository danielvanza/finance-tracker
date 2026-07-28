import type { Category } from '../types'
import CategorySelect from './CategorySelect'

export interface SplitRow {
  category_id: number | null
  amount: string // positive magnitude as typed by the user
}

export function splitRowsTotal(rows: SplitRow[]): number {
  return rows.reduce((sum, r) => {
    const n = parseFloat(r.amount)
    return sum + (isNaN(n) ? 0 : n)
  }, 0)
}

export function splitRowsValid(rows: SplitRow[], totalAmount: number): boolean {
  if (rows.length < 2) return false
  if (rows.some(r => r.category_id == null)) return false
  if (rows.some(r => { const n = parseFloat(r.amount); return isNaN(n) || n <= 0 })) return false
  // Compare in cents to dodge float noise
  return Math.round(splitRowsTotal(rows) * 100) === Math.round(Math.abs(totalAmount) * 100)
}

interface Props {
  totalAmount: number // signed parent amount
  categories: Category[]
  rows: SplitRow[]
  onChange: (rows: SplitRow[]) => void
}

export default function SplitEditor({ totalAmount, categories, rows, onChange }: Props) {
  const remaining = Math.round((Math.abs(totalAmount) - splitRowsTotal(rows)) * 100) / 100
  const balanced = remaining === 0

  const update = (idx: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const assignRemaining = () => {
    if (remaining <= 0 || rows.length === 0) return
    const idx = rows.length - 1
    const current = parseFloat(rows[idx].amount)
    const next = (isNaN(current) ? 0 : current) + remaining
    update(idx, { amount: next.toFixed(2) })
  }

  return (
    <div>
      {rows.map((row, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CategorySelect
              categories={categories}
              value={row.category_id}
              onChange={id => update(idx, { category_id: id })}
              compact
            />
          </div>
          <div style={{ position: 'relative', width: 110, flexShrink: 0 }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)', fontSize: 12.5, pointerEvents: 'none',
            }}>€</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={row.amount}
              onChange={e => update(idx, { amount: e.target.value })}
              placeholder="0.00"
              aria-label={`Split part ${idx + 1} amount`}
              style={{
                width: '100%',
                background: 'var(--bg-input)', color: 'var(--text-h)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius)',
                padding: '7px 10px 7px 24px',
                fontSize: 12.5, fontFamily: 'var(--mono)',
                fontVariantNumeric: 'tabular-nums',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            disabled={rows.length <= 2}
            aria-label={`Remove split part ${idx + 1}`}
            style={{
              background: 'transparent',
              color: rows.length <= 2 ? 'var(--text-muted)' : 'var(--red)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              width: 26, height: 26, flexShrink: 0,
              cursor: rows.length <= 2 ? 'default' : 'pointer',
              opacity: rows.length <= 2 ? 0.4 : 1,
              fontSize: 14, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => onChange([...rows, { category_id: null, amount: '' }])}
          style={{
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-sm)', padding: '5px 10px',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
          }}
        >
          + Add part
        </button>
        <button
          type="button"
          onClick={assignRemaining}
          disabled={balanced}
          title={balanced ? undefined : 'Assign the remaining amount to the last part'}
          style={{
            background: balanced ? 'var(--green-bg)' : 'var(--orange-bg)',
            color: balanced ? 'var(--green)' : 'var(--orange)',
            border: `1px solid ${balanced ? 'var(--green-border)' : 'var(--orange-border)'}`,
            borderRadius: 'var(--radius-full)', padding: '3px 10px',
            fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--mono)',
            fontVariantNumeric: 'tabular-nums',
            cursor: balanced ? 'default' : 'pointer',
          }}
        >
          {balanced ? 'Balanced ✓' : `Remaining: €${remaining.toFixed(2)}`}
        </button>
      </div>
    </div>
  )
}
