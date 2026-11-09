import { useState } from 'react'
import { X } from 'lucide-react'
import type { Transaction, Category } from '../types'
import { api } from '../api'
import { formatCents, parseToCents, centsToInputString } from '../money'
import CategorySelect from './CategorySelect'
import { describeApiError } from './ErrorBanner'
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
    try {
      await api.patchTransaction(tx.id, {
        splits: rows.map(r => ({
          category_id: r.category_id!,
          amount_cents: parseToCents(r.amount)! * sign,
        })),
      })
    } catch (e) {
      setError(describeApiError(e))
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
    try {
      await api.patchTransaction(tx.id, { splits: [], category_id: unsplitCategory })
    } catch (e) {
      setError(describeApiError(e))
      setSaving(false)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="tx-sheet-head">
          <h2>{tx.splits.length > 0 ? 'Edit split' : 'Split transaction'}</h2>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="tx-sheet-sub">
          <span className="tx-sheet-desc">{tx.description}</span>
          <span className={`num strong-amount${isPositive ? ' is-in' : ''}`}>
            {tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
          </span>
          {tx.is_refund && <span className="tx-tag">refund</span>}
        </p>

        <SplitEditor
          totalAmount={tx.amount_cents}
          categories={filteredCategories}
          rows={rows}
          onChange={setRows}
          seededRefunds={tx.splits.map(s => s.is_refund)}
        />

        {error && <p role="alert" className="tx-error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary tx-sheet-main" onClick={save} disabled={!valid || saving}>
            Save split
          </button>
        </div>

        {tx.splits.length > 0 && (
          <div className="split-unsplit">
            <span className="lab">Or un-split back to one category</span>
            <div className="split-unsplit-row">
              <CategorySelect
                categories={filteredCategories}
                value={unsplitCategory}
                onChange={setUnsplitCategory}
                compact
              />
              <button type="button" className="btn" onClick={unsplit} disabled={saving}>Un-split</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
