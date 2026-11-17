import { CalendarClock, PiggyBank } from 'lucide-react'
import { formatEuros } from '../../money'
import type { FreeToSpend } from '../../types'

const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
const dayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDate()

/** The fixed bills still to come before payday and what this month sets aside: why free is less than the bank says. */
export default function StillToPay({ free }: { free: FreeToSpend }) {
  const total = free.bills_cents + free.set_aside_cents
  const bills = [...free.bills].sort((a, b) => (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999'))
  return (
    <section className="ov-card" aria-labelledby="still-to-pay">
      <h2 id="still-to-pay" className="ov-card-head">
        Still to pay before payday
        {total > 0 && <span className="num">{formatEuros(total)}</span>}
      </h2>
      {bills.length === 0 && free.set_asides.length === 0 ? (
        <p className="ov-empty">Nothing else is due before payday.</p>
      ) : (
        <ul className="ov-list">
          {bills.map(bill => (
            <li key={bill.key} className="ov-row is-static">
              <span className="ov-date" aria-hidden="true">
                {bill.next_date ? <><b>{dayOf(bill.next_date)}</b>{weekday(bill.next_date)}</> : <CalendarClock size={18} />}
              </span>
              <span className="ov-row-text">
                {bill.name}
                <small>{bill.category_name}</small>
              </span>
              <span className="num ov-amt">{formatEuros(bill.amount_cents)}</span>
            </li>
          ))}
          {free.set_asides.map(item => (
            <li key={`set-${item.id}`} className="ov-row is-static">
              <span className="ov-date" aria-hidden="true"><PiggyBank size={18} /></span>
              <span className="ov-row-text">
                {item.name}
                <small>Set aside this month</small>
              </span>
              <span className="num ov-amt">{formatEuros(item.monthly_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
