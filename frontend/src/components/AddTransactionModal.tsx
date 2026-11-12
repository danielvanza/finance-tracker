import { useState } from 'react'
import { X } from 'lucide-react'
import type { Category } from '../types'
import { api } from '../api'
import CategorySelect from './CategorySelect'
import { describeApiError } from './ErrorBanner'
import { parseToCents } from '../money'

type Kind = 'expense' | 'income' | 'refund' | 'transfer'

const KIND_LABELS: Record<Kind, string> = {
  expense: 'Expense',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
}

interface Props {
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

export default function AddTransactionModal({ categories, onClose, onSaved }: Props) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<Kind>('expense')
  const [transferOut, setTransferOut] = useState(true)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const kindCategories = (k: Kind) => {
    if (k === 'income') return categories.filter(c => c.type === 'income')
    if (k === 'transfer') return categories.filter(c => c.type === 'exclude')
    return categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))
  }

  const changeKind = (k: Kind) => {
    setKind(k)
    setCategoryId(kindCategories(k)[0]?.id ?? null)
  }

  const parsedCents = parseToCents(amount || '0')

  const handleSave = async () => {
    setError('')
    if (!description.trim()) { setError('Description is required'); return }
    if (!parsedCents || parsedCents <= 0) { setError('Enter a positive amount'); return }
    setSaving(true)
    try {
      if (categoryId == null) { setError('Pick a category'); setSaving(false); return }
      const sign = kind === 'expense' || (kind === 'transfer' && transferOut) ? -1 : 1
      await api.createTransaction({
        date, description: description.trim(),
        amount_cents: parsedCents * sign,
        category_id: categoryId,
        is_refund: kind === 'refund',
      })
      onSaved()
      onClose()
    } catch (e) {
      setError(describeApiError(e))
      setSaving(false)
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="tx-sheet-head">
          <h2>Add transaction</h2>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-form">
          <div className="tx-form-two">
            <div className="form-row">
              <label className="lab" htmlFor="add-tx-date">Date</label>
              <input id="add-tx-date" className="field" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label className="lab" htmlFor="add-tx-amount">Amount (€)</label>
              <input
                id="add-tx-amount"
                className="field field-num"
                type="number" min="0.01" step="0.01" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <label className="lab" htmlFor="add-tx-description">Description</label>
            <input
              id="add-tx-description"
              className="field"
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Cash groceries"
            />
          </div>

          <div className="form-row">
            <span className="lab">Type</span>
            <div className="seg seg-fill">
              {(Object.keys(KIND_LABELS) as Kind[]).map(k => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => changeKind(k)}>
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          {kind === 'transfer' && (
            <div className="form-row">
              <span className="lab">Direction</span>
              <div className="seg seg-fill">
                {[true, false].map(out => (
                  <button key={String(out)} type="button" aria-pressed={transferOut === out} onClick={() => setTransferOut(out)}>
                    {out ? 'Money out (−)' : 'Money in (+)'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-row">
            <span className="lab">Category</span>
            <CategorySelect
              categories={kindCategories(kind)}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>
        </div>

        {error && <p role="alert" className="tx-error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary tx-sheet-main" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add transaction'}
          </button>
        </div>
      </div>
    </div>
  )
}
