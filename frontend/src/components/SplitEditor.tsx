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

const refundPillStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: 'var(--cyan)',
  background: 'var(--cyan-bg)',
  border: '1px solid var(--cyan-border)',
  padding: '1px 6px',
  borderRadius: 'var(--radius-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  flexShrink: 0,
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
          {seededRefunds?.[idx] && (
            <span title="This part nets against its category (refund)" style={refundPillStyle}>refund</span>
          )}
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
          {balanced ? 'Balanced ✓' : `Remaining: ${formatCents(remaining)}`}
        </button>
      </div>
    </div>
  )
}
