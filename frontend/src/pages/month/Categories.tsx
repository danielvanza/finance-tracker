import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import { dayLabel } from '../../dates'
import { centsToInputString, formatCents, formatEuros, parseToCents } from '../../money'
import type { BudgetRow, Category } from '../../types'
import CategorySelect from '../../components/CategorySelect'
import { describeApiError } from '../../components/ErrorBanner'
import { categoryStatus } from './projection'

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
    qc.invalidateQueries({ queryKey: ['transactions', { month, confirmed: 'true' }] })
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

  const recategorise = useMutation({
    mutationFn: ({ txId, categoryId }: { txId: number; categoryId: number }) =>
      api.patchTransaction(txId, { category_id: categoryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', { category_id: row.category_id, month }] })
      qc.invalidateQueries({ queryKey: ['rules'] })
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

const byShare = (a: BudgetRow, b: BudgetRow) =>
  share(b.actual_amount_cents ?? 0, b.planned_amount_cents) - share(a.actual_amount_cents ?? 0, a.planned_amount_cents)

/**
 * The plan by category: furthest through its budget first. A row opens to edit it and see what's in it.
 * While a row is open the order stays as it was, so saving a plan never moves the row you are editing;
 * it sorts again when the row closes (and the page starts fresh when the month changes).
 * `payments` (per category, null when the month is not known) and `elapsed` (share of the month gone) add a word to some rows.
 */
export default function Categories({ rows, month, categories, todayPct, payments, elapsed, onError }: {
  rows: BudgetRow[]
  month: string
  categories: Category[]
  todayPct: number | null
  payments: Record<number, number> | null
  elapsed: number | null
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [frozen, setFrozen] = useState<Map<number, number> | null>(null)

  const toggle = (id: number) => {
    if (open === id) {
      setOpen(null)
      setFrozen(null)
      return
    }
    // Switching straight from one open row to another keeps the order the first one froze.
    if (frozen === null) setFrozen(new Map([...rows].sort(byShare).map((r, i) => [r.category_id, i])))
    setOpen(id)
  }
  const order = (a: BudgetRow, b: BudgetRow) =>
    frozen ? (frozen.get(a.category_id) ?? Infinity) - (frozen.get(b.category_id) ?? Infinity) || byShare(a, b) : byShare(a, b)

  return (
    <div className="cat-groups">
      {KINDS.map(kind => {
        const group = rows.filter(r => r.category_type === kind.type).sort(order)
        if (group.length === 0) return null
        return (
          <section className="panel cat-group" key={kind.type} aria-label={kind.label}>
            <h3>{kind.label}</h3>
            <ul>
              {group.map(row => {
                const actual = row.actual_amount_cents ?? 0
                const isOpen = open === row.category_id
                const over = actual > row.planned_amount_cents
                const status = payments ? categoryStatus(actual, row.planned_amount_cents, payments[row.category_id] ?? 0, elapsed) : null
                return (
                  <li className="cat" key={row.id}>
                    <button
                      type="button"
                      className="cat-row"
                      aria-expanded={isOpen}
                      onClick={() => toggle(row.category_id)}
                    >
                      <span className="cat-name">{row.category_name}</span>
                      <span className="cat-amount num">
                        {over
                          ? <>{formatEuros(actual - row.planned_amount_cents)} over<small> · {formatEuros(actual)} of {formatEuros(row.planned_amount_cents)}</small></>
                          : <>{formatEuros(actual)}<small> of {formatEuros(row.planned_amount_cents)}{status?.kind === 'paid' && ' · paid'}</small></>}
                      </span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${percent(actual, row.planned_amount_cents)}%` }} />
                        {todayPct !== null && <b style={{ left: `${todayPct}%` }} />}
                      </span>
                      {status?.kind === 'ahead' && (
                        <span className="cat-note">On course for about {formatEuros(status.endCents)}, {formatEuros(status.overCents)} over</span>
                      )}
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
