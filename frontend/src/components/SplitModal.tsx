import { useState } from 'react'
import type { Transaction, Category } from '../types'
import { api } from '../api'
import { formatCents, parseToCents, centsToInputString } from '../money'
import CategorySelect from './CategorySelect'
import SplitEditor, { splitRowsValid, type SplitRow } from './SplitEditor'

interface Props {
  transaction: Transaction
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

export default function SplitModal({ transaction: tx, categories, onClose, onSaved }: Props) {
  const isPositive = tx.amount_cents > 0
  const filteredCategories = isPositive
    ? (tx.is_refund
        ? categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))
        : categories.filter(c => c.type === 'income' || c.type === 'exclude'))
    : categories.filter(c => c.type !== 'income')

  const [rows, setRows] = useState<SplitRow[]>(() =>
    tx.splits.length > 0
      ? tx.splits.map(s => ({ category_id: s.category_id, amount: centsToInputString(Math.abs(s.amount_cents)) }))
      : [{ category_id: null, amount: '' }, { category_id: null, amount: '' }]
  )
  const [unsplitCategory, setUnsplitCategory] = useState<number | null>(tx.category_id)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const sign = isPositive ? 1 : -1
  const valid = splitRowsValid(rows, tx.amount_cents)

  const save = async () => {
    if (!valid) return
    setError('')
    setSaving(true)
    const res = (await api.patchTransaction(tx.id, {
      splits: rows.map(r => ({
        category_id: r.category_id!,
        amount_cents: parseToCents(r.amount)! * sign,
      })),
    })) as { detail?: unknown }
    if (res.detail) {
      setError(typeof res.detail === 'string' ? res.detail : 'Could not save split')
      setSaving(false)
      return
    }
    onSaved()
    onClose()
  }

  const unsplit = async () => {
    if (unsplitCategory == null) { setError('Pick the single category to keep'); return }
    setError('')
    setSaving(true)
    const res = (await api.patchTransaction(tx.id, { splits: [], category_id: unsplitCategory })) as { detail?: unknown }
    if (res.detail) {
      setError(typeof res.detail === 'string' ? res.detail : 'Could not unsplit')
      setSaving(false)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          width: 480, maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.65)',
        }}
      >
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-h)' }}>
              {tx.splits.length > 0 ? 'Edit split' : 'Split transaction'}
            </h3>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'transparent', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
            }}>×</button>
          </div>
          <p style={{
            fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {tx.description} · <span style={{
              fontFamily: 'var(--mono)', fontWeight: 700,
              color: tx.amount_cents < 0 ? 'var(--red)' : 'var(--green)',
            }}>{tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}</span>
            {tx.is_refund && <span style={{ marginLeft: 8, color: 'var(--cyan)' }}>refund</span>}
          </p>

          <SplitEditor
            totalAmount={tx.amount_cents}
            categories={filteredCategories}
            rows={rows}
            onChange={setRows}
            seededRefunds={tx.splits.map(s => s.is_refund)}
          />

          {error && (
            <p style={{
              fontSize: 12, color: 'var(--red)', margin: '12px 0 0',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '7px 10px',
            }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={save}
              disabled={!valid || saving}
              style={{
                flex: 1,
                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius)', padding: '10px 16px',
                cursor: valid ? 'pointer' : 'not-allowed',
                opacity: valid && !saving ? 1 : 0.5,
                fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--sans)',
              }}
            >
              Save split
            </button>
            <button onClick={onClose} style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 16px',
              cursor: 'pointer', fontSize: 13.5, fontFamily: 'var(--sans)',
            }}>
              Cancel
            </button>
          </div>

          {tx.splits.length > 0 && (
            <div style={{
              marginTop: 18, paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}>
              <label style={{
                display: 'block', marginBottom: 7,
                fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                Or un-split back to one category
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CategorySelect
                    categories={filteredCategories}
                    value={unsplitCategory}
                    onChange={setUnsplitCategory}
                    compact
                  />
                </div>
                <button
                  onClick={unsplit}
                  disabled={saving}
                  style={{
                    background: 'transparent', color: 'var(--orange)',
                    border: '1px solid var(--orange-border)',
                    borderRadius: 'var(--radius)', padding: '6px 12px',
                    cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                    fontFamily: 'var(--sans)', flexShrink: 0,
                  }}
                >
                  Un-split
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
