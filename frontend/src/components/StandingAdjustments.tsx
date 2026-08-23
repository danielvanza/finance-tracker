import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { StandingAdjustment } from '../types'
import CategorySelect from './CategorySelect'
import { centsToInputString, parseToCents } from '../money'

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 6,
  fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
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

export default function StandingAdjustments() {
  const qc = useQueryClient()
  const { data: adjustments = [] } = useQuery({
    queryKey: ['standing-adjustments'],
    queryFn: api.getStandingAdjustments,
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [incomeCategoryId, setIncomeCategoryId] = useState<number | null>(null)
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [editedAmounts, setEditedAmounts] = useState<Record<number, string>>({})

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['standing-adjustments'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
  }

  const catName = (id: number) => categories.find(c => c.id === id)?.name ?? '?'

  const toggleActive = async (sa: StandingAdjustment) => {
    await api.patchStandingAdjustment(sa.id, { active: !sa.active })
    invalidate()
  }

  const saveAmount = async (sa: StandingAdjustment) => {
    const raw = editedAmounts[sa.id]
    if (raw == null) return
    const value = parseToCents(raw)
    if (value == null || value <= 0 || value === sa.amount_cents) {
      setEditedAmounts(prev => { const { [sa.id]: _, ...rest } = prev; return rest })
      return
    }
    await api.patchStandingAdjustment(sa.id, { amount_cents: value })
    setEditedAmounts(prev => { const { [sa.id]: _, ...rest } = prev; return rest })
    invalidate()
  }

  const remove = async (sa: StandingAdjustment) => {
    if (!window.confirm(`Delete standing adjustment "${sa.name}"? Rows already created in past months are kept.`)) return
    await api.deleteStandingAdjustment(sa.id)
    invalidate()
  }

  const add = async () => {
    setError('')
    const value = parseToCents(amount || '0')
    if (!name.trim()) { setError('Name is required'); return }
    if (!value || value <= 0) { setError('Enter a positive monthly amount'); return }
    if (incomeCategoryId == null || expenseCategoryId == null) { setError('Pick both categories'); return }
    const res = (await api.createStandingAdjustment({
      name: name.trim(), amount_cents: value,
      income_category_id: incomeCategoryId,
      expense_category_id: expenseCategoryId,
      active: true,
    })) as { detail?: unknown }
    if (res.detail) { setError(typeof res.detail === 'string' ? res.detail : 'Could not save'); return }
    setName(''); setAmount(''); setShowAdd(false)
    invalidate()
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
      padding: '24px 28px',
      border: '1px solid var(--border)',
      boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
      maxWidth: 520,
      marginTop: 24,
    }}>
      <h3 style={{
        fontSize: 14, fontWeight: 700, color: 'var(--text-h)',
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>Standing Adjustments</h3>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
        Net-zero pairs added automatically to each financial month — e.g. salary kept in a
        personal account: +income and −expense of the same amount. They correct income and
        spending without changing what's left over.
      </p>

      {adjustments.map(sa => (
        <div key={sa.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 0',
          borderBottom: '1px solid var(--border)',
          opacity: sa.active ? 1 : 0.55,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sa.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              +{catName(sa.income_category_id)} / −{catName(sa.expense_category_id)} · since {sa.start_month.slice(0, 7)}
            </div>
          </div>
          <div style={{ position: 'relative', width: 90, flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, pointerEvents: 'none' }}>€</span>
            <input
              type="number" min="0.01" step="0.01"
              value={editedAmounts[sa.id] ?? centsToInputString(sa.amount_cents)}
              onChange={e => setEditedAmounts(prev => ({ ...prev, [sa.id]: e.target.value }))}
              onBlur={() => saveAmount(sa)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label={`${sa.name} monthly amount`}
              style={{
                width: '100%', background: 'var(--bg-input)', color: 'var(--text-h)',
                border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
                padding: '5px 8px 5px 20px', fontSize: 12.5,
                fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', outline: 'none',
              }}
            />
          </div>
          <button
            onClick={() => toggleActive(sa)}
            title={sa.active ? 'Pause: stop adding to new months' : 'Resume for new months'}
            style={{
              background: sa.active ? 'var(--green-bg)' : 'transparent',
              color: sa.active ? 'var(--green)' : 'var(--text-muted)',
              border: `1px solid ${sa.active ? 'var(--green-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-full)', padding: '3px 10px',
              cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--sans)',
              flexShrink: 0,
            }}
          >
            {sa.active ? 'Active' : 'Paused'}
          </button>
          <button
            onClick={() => remove(sa)}
            aria-label={`Delete ${sa.name}`}
            style={{
              background: 'transparent', color: 'var(--red)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 'var(--radius-sm)', width: 24, height: 24,
              cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>
      ))}

      {adjustments.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          No standing adjustments yet.
        </p>
      )}

      {showAdd ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Personal allowance — Alex" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>€ / month</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="600.00"
                style={{ ...inputStyle, fontFamily: 'var(--mono)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Income leg (+)</label>
              <CategorySelect
                categories={categories.filter(c => c.type === 'income')}
                value={incomeCategoryId}
                onChange={setIncomeCategoryId}
                compact
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Expense leg (−)</label>
              <CategorySelect
                categories={categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))}
                value={expenseCategoryId}
                onChange={setExpenseCategoryId}
                compact
              />
            </div>
          </div>
          {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={add} style={{
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius)', padding: '8px 16px',
              cursor: 'pointer', fontWeight: 600, fontSize: 12.5, fontFamily: 'var(--sans)',
            }}>Add</button>
            <button onClick={() => { setShowAdd(false); setError('') }} style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '8px 16px',
              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          style={{
            marginTop: 14,
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-sm)', padding: '6px 12px',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
          }}
        >
          + Add standing adjustment
        </button>
      )}
    </div>
  )
}
