import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { dayLabel } from '../../dates'
import { formatEuros } from '../../money'
import { useRecurring } from './api'
import RecurringSheet from './RecurringSheet'
import '../../styles/recurring.css'

/**
 * The link row on Month that opens the Recurring payments sheet. It fetches its own data and hides
 * itself when there is nothing to say: still loading, failed, nothing repeating yet, bank files behind,
 * or a month that is already over. Usage: `<RecurringLink month={pace.month} />` in `.side-stack`,
 * after the review link.
 */
export default function RecurringLink({ month }: { month: string }) {
  const { data } = useRecurring(month)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => button.current?.focus())
  }, [])

  if (!data || data.status !== 'ok' || data.end_date < data.today) return null

  const due = data.items.filter(i => i.state === 'due')
  const expected = data.items.filter(i => i.state === 'expected')
  const paid = data.items.filter(i => i.state === 'paid').length
  let title: string
  let small: string
  if (due.length > 0) {
    title = `${formatEuros(data.due_cents)} still to pay`
    small = due.slice(0, 2).map(i => `${i.name.split(' ')[0]} ${dayLabel(i.next_date!)}`).join(', ')
  } else if (expected.length > 0) {
    title = 'Recurring payments'
    small = `${expected.length} expected, not confirmed`
  } else {
    title = 'Nothing more to pay'
    small = `Recurring payments · ${paid} paid this month`
  }

  return (
    <>
      <button ref={button} type="button" className="link-row rc-entry" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="rc-entry-t">
          {title}
          <small>{small}</small>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {open && createPortal(<RecurringSheet data={data} onClose={close} />, document.body)}
    </>
  )
}
