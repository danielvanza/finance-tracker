import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { StandingAdjustment } from '../types'
import CategorySelect from './CategorySelect'
import ErrorBanner, { describeApiError } from './ErrorBanner'
import { centsToInputString, parseToCents } from '../money'

export default function StandingAdjustments() {
  const qc = useQueryClient()
  const adjustmentsQuery = useQuery({
    queryKey: ['standing-adjustments'],
    queryFn: api.getStandingAdjustments,
  })
  const adjustments = adjustmentsQuery.data ?? []
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
    try {
      await api.patchStandingAdjustment(sa.id, { active: !sa.active })
      invalidate()
    } catch (e) {
      setError(describeApiError(e))
    }
  }

  const saveAmount = async (sa: StandingAdjustment) => {
    const raw = editedAmounts[sa.id]
    if (raw == null) return
    const value = parseToCents(raw)
    if (value == null || value <= 0 || value === sa.amount_cents) {
      setEditedAmounts(prev => { const { [sa.id]: _, ...rest } = prev; return rest })
      return
    }
    try {
      await api.patchStandingAdjustment(sa.id, { amount_cents: value })
    } catch (e) {
      setError(describeApiError(e))
      return
    }
    setEditedAmounts(prev => { const { [sa.id]: _, ...rest } = prev; return rest })
    invalidate()
  }

  const remove = async (sa: StandingAdjustment) => {
    if (!window.confirm(`Delete standing adjustment "${sa.name}"? Rows already created in past months are kept.`)) return
    try {
      await api.deleteStandingAdjustment(sa.id)
      invalidate()
    } catch (e) {
      setError(describeApiError(e))
    }
  }

  const add = async () => {
    setError('')
    const value = parseToCents(amount || '0')
    if (!name.trim()) { setError('Name is required'); return }
    if (!value || value <= 0) { setError('Enter a positive monthly amount'); return }
    if (incomeCategoryId == null || expenseCategoryId == null) { setError('Pick both categories'); return }
    try {
      await api.createStandingAdjustment({
        name: name.trim(), amount_cents: value,
        income_category_id: incomeCategoryId,
        expense_category_id: expenseCategoryId,
        active: true,
      })
    } catch (e) {
      setError(describeApiError(e)); return
    }
    setName(''); setAmount(''); setShowAdd(false)
    invalidate()
  }

  return (
    <section className="section">
      <h2>Standing adjustments</h2>

      {adjustmentsQuery.isLoading && <span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading standing adjustments" />}
      {adjustmentsQuery.isError && <ErrorBanner message={describeApiError(adjustmentsQuery.error)} />}

      {adjustmentsQuery.isSuccess && (
        <div className="panel setup-panel">
          <p className="setup-note">
            Added to every financial month as a matching income and expense, for example salary kept in a
            personal account. They correct income and spending without changing what's left over.
          </p>

          {adjustments.map(sa => (
            <div className={`setup-adj${sa.active ? '' : ' is-paused'}`} key={sa.id}>
              <div className="setup-adj-text">
                <strong>{sa.name}</strong>
                <small>
                  +{catName(sa.income_category_id)} / −{catName(sa.expense_category_id)} · since {sa.start_month.slice(0, 7)}
                  {!sa.active && ' · paused'}
                </small>
              </div>
              <div className="setup-amount">
                <span aria-hidden="true">€</span>
                <input
                  className="field field-num"
                  type="number" min="0.01" step="0.01"
                  value={editedAmounts[sa.id] ?? centsToInputString(sa.amount_cents)}
                  onChange={e => setEditedAmounts(prev => ({ ...prev, [sa.id]: e.target.value }))}
                  onBlur={() => saveAmount(sa)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  aria-label={`${sa.name} monthly amount`}
                />
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => toggleActive(sa)}
                title={sa.active ? 'Pause: stop adding to new months' : 'Resume for new months'}
              >
                {sa.active ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger setup-icon"
                onClick={() => remove(sa)}
                aria-label={`Delete ${sa.name}`}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          ))}

          {adjustments.length === 0 && <p className="empty">No standing adjustments yet.</p>}

          {error && <p role="alert" className="setup-error">{error}</p>}

          {showAdd ? (
            <div className="setup-add-form">
              <div className="setup-form">
                <div className="form-row">
                  <label className="lab" htmlFor="adjustment-name">Name</label>
                  <input
                    id="adjustment-name"
                    className="field"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Personal allowance — Alex"
                  />
                </div>
                <div className="form-row">
                  <label className="lab" htmlFor="adjustment-amount">€ per month</label>
                  <input
                    id="adjustment-amount"
                    className="field field-num"
                    type="number" min="0.01" step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="600.00"
                  />
                </div>
                <div className="form-row">
                  <span className="lab">Income category</span>
                  <CategorySelect
                    categories={categories.filter(c => c.type === 'income')}
                    value={incomeCategoryId}
                    onChange={setIncomeCategoryId}
                    compact
                  />
                </div>
                <div className="form-row">
                  <span className="lab">Expense category</span>
                  <CategorySelect
                    categories={categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))}
                    value={expenseCategoryId}
                    onChange={setExpenseCategoryId}
                    compact
                  />
                </div>
              </div>
              <div className="setup-form-actions">
                <button type="button" className="btn" onClick={add}>Add adjustment</button>
                <button type="button" className="btn" onClick={() => { setShowAdd(false); setError('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setShowAdd(true)}>
              <Plus size={15} aria-hidden="true" />
              Add standing adjustment
            </button>
          )}
        </div>
      )}
    </section>
  )
}
