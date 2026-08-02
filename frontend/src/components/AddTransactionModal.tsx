import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Category } from '../types'
import { api } from '../api'
import CategorySelect from './CategorySelect'

type Mode = 'single' | 'pair'
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)', color: 'var(--text-h)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  fontSize: 13, fontFamily: 'var(--sans)',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 6,
  fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
}

export default function AddTransactionModal({ categories, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<Mode>('single')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<Kind>('expense')
  const [transferOut, setTransferOut] = useState(true)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const { data: standingAdjustments = [] } = useQuery({
    queryKey: ['standing-adjustments'],
    queryFn: api.getStandingAdjustments,
  })
  const defaultPair = standingAdjustments.find(sa => sa.active) ?? standingAdjustments[0]
  const [incomeCategoryId, setIncomeCategoryId] = useState<number | null>(null)
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!defaultPair) return
    setIncomeCategoryId(prev => prev ?? defaultPair.income_category_id)
    setExpenseCategoryId(prev => prev ?? defaultPair.expense_category_id)
  }, [defaultPair])

  const kindCategories = (k: Kind) => {
    if (k === 'income') return categories.filter(c => c.type === 'income')
    if (k === 'transfer') return categories.filter(c => c.type === 'exclude')
    return categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))
  }

  const changeKind = (k: Kind) => {
    setKind(k)
    setCategoryId(kindCategories(k)[0]?.id ?? null)
  }

  const parsedAmount = Math.round(parseFloat(amount || '0') * 100) / 100

  const handleSave = async () => {
    setError('')
    if (!description.trim()) { setError('Description is required'); return }
    if (!parsedAmount || parsedAmount <= 0) { setError('Enter a positive amount'); return }
    setSaving(true)
    try {
      if (mode === 'single') {
        if (categoryId == null) { setError('Pick a category'); setSaving(false); return }
        const sign = kind === 'expense' || (kind === 'transfer' && transferOut) ? -1 : 1
        const res = await api.createTransaction({
          date, description: description.trim(),
          amount: parsedAmount * sign,
          category_id: categoryId,
          is_refund: kind === 'refund',
        })
        if (res.detail) { setError(typeof res.detail === 'string' ? res.detail : 'Could not save'); setSaving(false); return }
      } else {
        if (incomeCategoryId == null || expenseCategoryId == null) {
          setError('Pick both categories'); setSaving(false); return
        }
        const res = await api.createAdjustmentPair({
          date, description: description.trim(),
          legs: [
            { amount: parsedAmount, category_id: incomeCategoryId },
            { amount: -parsedAmount, category_id: expenseCategoryId },
          ],
        })
        if (res.detail) { setError(typeof res.detail === 'string' ? res.detail : 'Could not save'); setSaving(false); return }
      }
      onSaved()
      onClose()
    } catch {
      setError('Could not save transaction')
      setSaving(false)
    }
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
          overflow: 'visible',
        }}
      >
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-h)' }}>Add transaction</h3>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'transparent', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
            }}>×</button>
          </div>

          {/* Mode tabs */}
          <div style={{
            display: 'flex', gap: 4, marginBottom: 16,
            background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)', padding: 3,
          }}>
            {(['single', 'pair'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1,
                background: mode === m ? 'var(--accent-bg)' : 'transparent',
                color: mode === m ? 'var(--accent-light)' : 'var(--text-secondary)',
                border: `1px solid ${mode === m ? 'var(--accent-border)' : 'transparent'}`,
                borderRadius: 'var(--radius-sm)', padding: '7px 8px',
                cursor: 'pointer', fontSize: 12.5, fontWeight: mode === m ? 700 : 500,
                fontFamily: 'var(--sans)',
              }}>
                {m === 'single' ? 'Single' : 'Adjustment pair'}
              </button>
            ))}
          </div>
          {mode === 'pair' && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 14, marginTop: -8 }}>
              Two rows that net to zero: +income and −expense of the same amount. Corrects income
              and spending without changing what's left over.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Amount (€)</label>
              <input
                type="number" min="0.01" step="0.01" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
                style={{ ...inputStyle, fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Description</label>
            <input
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder={mode === 'pair' ? 'e.g. Personal budget March' : 'e.g. Cash groceries'}
              style={inputStyle}
            />
          </div>

          {mode === 'single' ? (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Type</label>
                <div style={{
                  display: 'flex', gap: 4,
                  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius)', padding: 3,
                }}>
                  {(Object.keys(KIND_LABELS) as Kind[]).map(k => (
                    <button key={k} onClick={() => changeKind(k)} style={{
                      flex: 1,
                      background: kind === k ? 'var(--accent-bg)' : 'transparent',
                      color: kind === k ? 'var(--accent-light)' : 'var(--text-secondary)',
                      border: `1px solid ${kind === k ? 'var(--accent-border)' : 'transparent'}`,
                      borderRadius: 'var(--radius-sm)', padding: '6px 4px',
                      cursor: 'pointer', fontSize: 12, fontWeight: kind === k ? 700 : 500,
                      fontFamily: 'var(--sans)',
                    }}>
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
              {kind === 'transfer' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Direction</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[true, false].map(out => (
                      <button key={String(out)} onClick={() => setTransferOut(out)} style={{
                        flex: 1,
                        background: transferOut === out ? 'var(--accent-bg)' : 'transparent',
                        color: transferOut === out ? 'var(--accent-light)' : 'var(--text-secondary)',
                        border: `1px solid ${transferOut === out ? 'var(--accent-border)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                        cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
                      }}>
                        {out ? 'Money out (−)' : 'Money in (+)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Category</label>
                <CategorySelect
                  categories={kindCategories(kind)}
                  value={categoryId}
                  onChange={setCategoryId}
                />
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Income leg (+€{parsedAmount > 0 ? parsedAmount.toFixed(2) : '…'})</label>
                <CategorySelect
                  categories={categories.filter(c => c.type === 'income')}
                  value={incomeCategoryId}
                  onChange={setIncomeCategoryId}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Expense leg (−€{parsedAmount > 0 ? parsedAmount.toFixed(2) : '…'})</label>
                <CategorySelect
                  categories={categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))}
                  value={expenseCategoryId}
                  onChange={setExpenseCategoryId}
                />
              </div>
            </>
          )}

          {error && (
            <p style={{
              fontSize: 12, color: 'var(--red)', marginBottom: 12,
              background: 'var(--red-bg, rgba(248,113,113,0.08))',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '7px 10px',
            }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1,
                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius)', padding: '10px 16px',
                cursor: 'pointer', fontWeight: 600, fontSize: 13.5,
                fontFamily: 'var(--sans)',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : mode === 'pair' ? 'Add pair' : 'Add transaction'}
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
        </div>
      </div>
    </div>
  )
}
