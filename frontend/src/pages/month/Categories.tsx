import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import { dayLabel } from '../../dates'
import { centsToInputString, formatCents, formatEuros, parseToCents } from '../../money'
import type { BudgetRow, Category } from '../../types'
import CategorySelect from '../../components/CategorySelect'
import { describeApiError } from '../../components/ErrorBanner'

const KINDS = [
  { type: 'needs', label: 'Needs' },
  { type: 'wants', label: 'Wants' },
  { type: 'savings', label: 'Savings' },
] as const

const share = (actual: number, planned: number) => (planned > 0 ? actual / planned : actual > 0 ? Infinity : 0)
const percent = (actual: number, planned: number) => Math.max(0, Math.min(100, share(actual, planned) * 100))

function Detail({ row, month, categories, onError }: {
  row: BudgetRow
  month: string
  categories: Category[]
  onError: (message: string) => void
}) {
  const qc = useQueryClient()
  const [plan, setPlan] = useState(centsToInputString(row.planned_amount_cents))
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ['transactions', { category_id: row.category_id, month }],
    queryFn: () => api.getTransactions({ category_id: String(row.category_id), month, confirmed: 'true' }),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['budget', month] })
    qc.invalidateQueries({ queryKey: ['pace'] })
    qc.invalidateQueries({ queryKey: ['dashboard', month] })
  }

  const savePlan = async () => {
    const cents = parseToCents(plan)
    if (cents === null || cents === row.planned_amount_cents) return
    try {
      await api.patchBudget(row.id, cents)
      refresh()
    } catch (e) {
      onError(describeApiError(e))
    }
  }

  const changeType = async (type: string) => {
    try {
      await api.patchCategory(row.category_id, { type })
      qc.invalidateQueries({ queryKey: ['categories'] })
      refresh()
    } catch (e) {
      onError(describeApiError(e))
    }
  }

  const recategorise = useMutation({
    mutationFn: ({ txId, categoryId }: { txId: number; categoryId: number }) =>
      api.patchTransaction(txId, { category_id: categoryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', { category_id: row.category_id, month }] })
      refresh()
    },
    onError: e => onError(describeApiError(e)),
  })

  const choices = categories.filter(c => c.type !== 'income')

  return (
    <div className="well cat-detail">
      <div className="cat-fields">
        <div className="form-row">
          <label className="lab" htmlFor={`plan-${row.id}`}>Planned</label>
          <input
            id={`plan-${row.id}`}
            className="field field-num"
            inputMode="decimal"
            value={plan}
            onChange={e => setPlan(e.target.value)}
            onBlur={savePlan}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
        <div className="form-row">
          <label className="lab" htmlFor={`type-${row.id}`}>Counts as</label>
          <select
            id={`type-${row.id}`}
            className="field"
            value={row.category_type}
            onChange={e => changeType(e.target.value)}
          >
            {KINDS.map(k => <option key={k.type} value={k.type}>{k.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        {isLoading && <span className="skeleton cat-skel" />}
        {!isLoading && txs.length === 0 && <p className="muted">No confirmed transactions this month.</p>}
        {txs.map(tx => (
          <div className="cat-tx" key={tx.id}>
            <time dateTime={tx.date}>{dayLabel(tx.date)}</time>
            <span>{tx.description}</span>
            <span className="num">{tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}</span>
            <CategorySelect
              categories={choices}
              value={tx.category_id}
              onChange={id => recategorise.mutate({ txId: tx.id, categoryId: id })}
              compact
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The plan by category: furthest through its budget first. A row opens to edit it and see what's in it. */
export default function Categories({ rows, month, categories, todayPct, onError }: {
  rows: BudgetRow[]
  month: string
  categories: Category[]
  todayPct: number | null
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="cat-groups">
      {KINDS.map(kind => {
        const group = rows
          .filter(r => r.category_type === kind.type)
          .sort((a, b) => share(b.actual_amount_cents ?? 0, b.planned_amount_cents) - share(a.actual_amount_cents ?? 0, a.planned_amount_cents))
        if (group.length === 0) return null
        return (
          <section className="panel cat-group" key={kind.type} aria-label={kind.label}>
            <h3>{kind.label}</h3>
            <ul>
              {group.map(row => {
                const actual = row.actual_amount_cents ?? 0
                const isOpen = open === row.category_id
                const over = actual > row.planned_amount_cents
                return (
                  <li className="cat" key={row.id}>
                    <button
                      type="button"
                      className="cat-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : row.category_id)}
                    >
                      <span className="cat-name">{row.category_name}</span>
                      <span className="cat-amount num">
                        {over
                          ? <>{formatEuros(actual - row.planned_amount_cents)} over<small> · {formatEuros(actual)} of {formatEuros(row.planned_amount_cents)}</small></>
                          : <>{formatEuros(actual)}<small> of {formatEuros(row.planned_amount_cents)}</small></>}
                      </span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${percent(actual, row.planned_amount_cents)}%` }} />
                        {todayPct !== null && <b style={{ left: `${todayPct}%` }} />}
                      </span>
                    </button>
                    {isOpen && <Detail row={row} month={month} categories={categories} onError={onError} />}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
