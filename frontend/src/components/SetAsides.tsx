import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api } from '../api'
import { dayLabel } from '../dates'
import { centsToInputString, formatCents, formatEuros, parseToCents } from '../money'
import type { SetAside } from '../types'
import ErrorBanner, { describeApiError } from './ErrorBanner'

const monthWord = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

/** How often a bill can come back, in months; null: it comes once. */
const EVERY: { months: number | null; label: string }[] = [
  { months: 3, label: 'Every 3 months' },
  { months: 6, label: 'Every 6 months' },
  { months: 12, label: 'Every year' },
  { months: null, label: 'Once' },
]

const everyWord = (months: number) => (months === 12 ? 'every year' : `every ${months} months`)

function about(bill: SetAside) {
  const parts = [`${formatEuros(bill.amount_cents)} due ${monthWord(bill.due_month)}`]
  if (bill.every_months) parts.push(everyWord(bill.every_months))
  if (bill.over) parts.push('its month has passed')
  else if (bill.payment) parts.push(`paid ${dayLabel(bill.payment.date)}`)
  else parts.push(`${formatEuros(bill.monthly_cents)} this month`, `${formatEuros(bill.saved_cents)} set aside so far`)
  return parts.join(' · ')
}

/** Setup > Set-asides: bills that do not come monthly, spread over the months before they are due. */
export default function SetAsides() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['set-asides'], queryFn: () => api.getSetAsides() })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [every, setEvery] = useState('12')
  const [paying, setPaying] = useState<number | null>(null)
  const [payment, setPayment] = useState('')
  const [error, setError] = useState('')

  // The payments a bill could be: money that went out, newest first.
  const payments = useQuery({
    queryKey: ['transactions', 'all'], queryFn: () => api.getTransactions(), enabled: paying !== null,
    select: rows => rows.filter(t => t.amount_cents < 0 && t.set_aside_id === null && t.splits.length === 0)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['set-asides'] })
    qc.invalidateQueries({ queryKey: ['pace'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
  }
  const run = async (work: () => Promise<unknown>) => {
    setError('')
    try {
      await work()
      refresh()
      return true
    } catch (e) {
      setError(describeApiError(e))
      return false
    }
  }

  const add = async () => {
    const cents = parseToCents(amount)
    if (!name.trim()) { setError('Give the bill a name.'); return }
    if (cents === null || cents <= 0) { setError('Enter the amount of the bill.'); return }
    if (!/^\d{4}-\d{2}$/.test(due)) { setError('Pick the month the bill is due.'); return }
    if (await run(() => api.createSetAside({ name: name.trim(), amount_cents: cents, due_month: due, every_months: every ? Number(every) : null }))) {
      setName(''); setAmount(''); setDue(''); setEvery('12'); setAdding(false)
    }
  }

  const items = query.data?.items ?? []
  return (
    <section className="section" aria-labelledby="set-asides-title">
      <h2 id="set-asides-title">Set-asides</h2>
      {query.isLoading && <span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading set-asides" />}
      {query.isError && <ErrorBanner message={describeApiError(query.error)} />}
      {query.isSuccess && (
        <div className="panel setup-panel">
          <p className="setup-note">
            For a bill that does not come every month: car tax each quarter, car insurance, a holiday, the municipal taxes. Its
            amount is spread over the months until it is due, and each month's share lowers what is free to spend.
            When the bill is paid, mark the payment here and it comes out of what was set aside; only what was
            not set aside yet counts as spending.
          </p>
          {error && <p role="alert" className="setup-error">{error}</p>}
          {items.map(bill => (
            <div className="setup-adj" key={bill.id} data-set-aside={bill.name}>
              <span className="setup-adj-text">
                <strong>{bill.name}</strong>
                <small className="num">{about(bill)}</small>
                {bill.payment && (
                  <small className="num">
                    Paid with {bill.payment.description}, {formatCents(Math.abs(bill.payment.amount_cents))}
                    {bill.payment.counted_cents > 0 && <> · {formatCents(bill.payment.counted_cents)} of it was not set aside yet and counts as spending</>}
                  </small>
                )}
              </span>
              {bill.payment ? (
                <button type="button" className="btn btn-sm" onClick={() => run(() => api.unpaySetAside(bill.id, bill.payment!.transaction_id))}>
                  Not this payment
                </button>
              ) : (
                <button type="button" className="btn btn-sm" aria-expanded={paying === bill.id}
                  onClick={() => { setPaying(paying === bill.id ? null : bill.id); setPayment('') }}>
                  Mark as paid
                </button>
              )}
              <button type="button" className="btn setup-icon" aria-label={`Delete ${bill.name}`}
                onClick={() => window.confirm(`Delete the set-aside "${bill.name}"?`) && run(() => api.deleteSetAside(bill.id))}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
              {paying === bill.id && (
                <div className="well setup-form setup-pay">
                  <div className="form-row">
                    <label className="lab" htmlFor={`pay-${bill.id}`}>Which payment was this bill?</label>
                    <select id={`pay-${bill.id}`} className="field" value={payment} onChange={e => setPayment(e.target.value)}>
                      <option value="">{payments.isLoading ? 'Loading payments…' : 'Choose a payment'}</option>
                      {(payments.data ?? []).map(t => (
                        <option key={t.id} value={t.id}>
                          {dayLabel(t.date)} · {t.description} · {formatCents(Math.abs(t.amount_cents))}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="setup-form-actions">
                    <button type="button" className="btn btn-primary" disabled={!payment}
                      onClick={async () => { if (await run(() => api.paySetAside(bill.id, Number(payment)))) setPaying(null) }}>
                      Paid from this set-aside
                    </button>
                    <button type="button" className="btn" onClick={() => setPaying(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && <p className="empty">No set-asides yet.</p>}

          {adding ? (
            <div className="well setup-form">
              <div className="form-row">
                <label className="lab" htmlFor="set-aside-name">Name</label>
                <input id="set-aside-name" className="field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Car insurance" />
              </div>
              <div className="form-row">
                <label className="lab" htmlFor="set-aside-amount">Amount of the bill (€)</label>
                <input id="set-aside-amount" className="field field-num" inputMode="decimal" value={amount}
                  onChange={e => setAmount(e.target.value)} placeholder={centsToInputString(60000)} />
              </div>
              <div className="form-row">
                <label className="lab" htmlFor="set-aside-due">Month it is next due</label>
                <input id="set-aside-due" className="field" type="month" value={due} onChange={e => setDue(e.target.value)} />
              </div>
              <div className="form-row">
                <label className="lab" htmlFor="set-aside-every">How often it comes</label>
                <select id="set-aside-every" className="field" value={every} onChange={e => setEvery(e.target.value)}>
                  {EVERY.map(o => <option key={o.label} value={o.months ?? ''}>{o.label}</option>)}
                </select>
              </div>
              <div className="setup-form-actions">
                <button type="button" className="btn btn-primary" onClick={add}>Add set-aside</button>
                <button type="button" className="btn" onClick={() => { setAdding(false); setError('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setAdding(true)}>Add a set-aside</button>
          )}
        </div>
      )}
    </section>
  )
}
