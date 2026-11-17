import { Link } from 'react-router-dom'
import { AlertCircle, Check, ChevronRight, CircleHelp, Upload } from 'lucide-react'
import { dayLabel } from '../../dates'
import { formatEuros } from '../../money'
import type { BudgetRow, Category, Pace } from '../../types'
import { overCategories } from './figures'

const STALE_DAYS = 7

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)

/** What needs one of the two of you: payments to sort, categories over plan, bank data gone stale. */
export default function NeedsYou({ pace, rows, categories }: { pace: Pace; rows: BudgetRow[]; categories: Category[] }) {
  const isCurrent = pace.month === pace.current_month
  const over = pace.status === 'ok' ? overCategories(rows, categories).slice(0, 4) : []
  const newest = pace.newest_bank_date
  const stale = isCurrent && pace.status === 'ok' && newest !== null && daysBetween(newest, pace.today) > STALE_DAYS

  const items = []
  if (pace.to_review > 0) {
    items.push(
      <li key="review">
        <Link to="/transactions?review=1" className="ov-row">
          <span className="ov-icon is-watch"><CircleHelp size={18} aria-hidden="true" /></span>
          <span className="ov-row-text">
            {pace.to_review} payment{pace.to_review === 1 ? '' : 's'} to sort
            <small>Claude wasn't sure. {pace.to_review === 1 ? 'It counts' : 'They count'} once answered.</small>
          </span>
          <ChevronRight className="ov-chev" size={18} aria-hidden="true" />
        </Link>
      </li>,
    )
  }
  for (const { row, over: by } of over) {
    items.push(
      <li key={`over-${row.category_id}`}>
        <Link to={`/transactions?category=${row.category_id}&month=1`} className="ov-row">
          <span className="ov-icon is-over"><AlertCircle size={18} aria-hidden="true" /></span>
          <span className="ov-row-text">
            {row.category_name} is {formatEuros(by)} over
            <small>{formatEuros(row.actual_amount_cents ?? 0)} of {formatEuros(row.planned_amount_cents)}</small>
          </span>
          <ChevronRight className="ov-chev" size={18} aria-hidden="true" />
        </Link>
      </li>,
    )
  }
  if (stale) {
    items.push(
      <li key="stale">
        <Link to="/import" className="ov-row">
          <span className="ov-icon is-watch"><Upload size={18} aria-hidden="true" /></span>
          <span className="ov-row-text">
            Bank data stops on {dayLabel(newest!)}
            <small>{daysBetween(newest!, pace.today)} days ago. Import a new file to keep this right.</small>
          </span>
          <ChevronRight className="ov-chev" size={18} aria-hidden="true" />
        </Link>
      </li>,
    )
  }

  return (
    <section className="ov-card" aria-labelledby="needs-you">
      <h2 id="needs-you">Needs you</h2>
      {items.length > 0 ? (
        <ul className="ov-list">{items}</ul>
      ) : (
        <p className="ov-sorted">
          <span className="ov-icon is-ok"><Check size={18} aria-hidden="true" /></span>
          All sorted
        </p>
      )}
    </section>
  )
}
