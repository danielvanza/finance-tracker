import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import { Check, X } from 'lucide-react'
import { dayLabel } from '../../dates'
import { formatCents, formatEuros } from '../../money'
import type { Recurring, RecurringItem } from './types'
import '../../styles/recurring.css'

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const words = (n: number) => WORDS[n] ?? String(n)
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, one: string, many: string) => `${words(n)} ${n === 1 ? one : many}`

const dayNumber = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000
const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from))
const addDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10)

const list = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** When the next payment comes, in the words of the day it is today. */
function dueWhen(item: RecurringItem, today: string) {
  const next = item.next_date!
  const away = daysBetween(today, next)
  if (away < 0) return `Was due ${dayLabel(next)}`
  const in_ = away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`
  return `${dayLabel(next)} · ${in_}`
}

function Row({ item, kind, data, open, onToggle, onCount }: {
  item: RecurringItem
  kind: 'due' | 'expected' | 'paid' | 'stopped' | 'ignored'
  data: Recurring
  open: boolean
  onToggle: () => void
  /** Leave this payment out of the fixed bills, or count it again. */
  onCount: (item: RecurringItem, counted: boolean) => void
}) {
  const id = `rc-hist-${item.key.replace(/\W+/g, '-')}`
  const more = item.remaining > 1 ? ` · ${item.remaining} to go` : ''
  const rise = item.price_change ? item.price_change.to_cents - item.price_change.from_cents : 0
  return (
    <li>
      <button
        type="button"
        className={`rc-row${kind === 'paid' ? ' is-paid' : ''}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onToggle}
      >
        <span className="rc-name">{item.name}</span>
        <span className="rc-amt">{formatCents(item.amount_cents)}</span>
        <span className="rc-when">
          {kind === 'due' && `${dueWhen(item, data.today)} · ${item.cadence}${more}`}
          {kind === 'expected' && `Expected ${dayLabel(item.next_date!)} · ${item.cadence}${more}`}
          {kind === 'paid' && <><Check className="rc-tick" size={14} strokeWidth={2.4} aria-hidden="true" />Paid {dayLabel(item.last_date)}</>}
          {kind === 'stopped' && `Last paid ${dayLabel(item.last_date)}`}
          {kind === 'ignored' && `Last paid ${dayLabel(item.last_date)} · ${item.cadence} · not counted`}
          {rise > 0 && <span className="rc-flag">Up {formatCents(rise)}</span>}
        </span>
      </button>
      {open && (
        <div className="well rc-hist" id={id} role="region" aria-label={`Last payments, ${item.name}`}>
          <dl>
            {item.history.map(h => (
              <div key={h.date}><dt>{dayLabel(h.date)}</dt><dd>{formatCents(h.amount_cents)}</dd></div>
            ))}
          </dl>
          {kind !== 'stopped' && (
            <button type="button" className="btn btn-sm rc-count" onClick={() => onCount(item, kind === 'ignored')}>
              {kind === 'ignored' ? 'Count as a fixed bill again' : 'Not a fixed bill'}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** What the sheet says first: the sum still to pay, or why it can't say. */
function lead(data: Recurring, due: RecurringItem[], expected: RecurringItem[]) {
  const end = dayLabel(data.end_date)
  if (data.status === 'none') {
    return { head: 'Nothing repeating yet', sub: 'A payment shows up here once the same one has come in three times, on a regular day.' }
  }
  if (data.status === 'gap') {
    return {
      head: "Can't tell yet",
      sub: data.data_through
        ? `Bank files stop on ${dayLabel(data.data_through)}, so payments since then can't be matched. These are expected.`
        : "There are no bank files to match payments against, so these are expected.",
    }
  }
  const comingDue = due.reduce((n, i) => n + i.remaining, 0)
  const comingExpected = expected.reduce((n, i) => n + i.remaining, 0)
  if (comingDue > 0) {
    return {
      head: `${formatEuros(data.due_cents)} still to pay`,
      sub: `${sentence(plural(comingDue, 'payment', 'payments'))} before ${end}. ` + (comingExpected > 0
        ? `${sentence(words(comingExpected))} more expected, as a bank file stops short of the date.`
        : 'Everything else this month is already paid.'),
    }
  }
  if (comingExpected > 0) {
    return { head: "Can't tell yet", sub: 'A bank file stops before these dates, so they are expected, not confirmed.' }
  }
  return { head: 'Nothing more to pay', sub: `Every repeating payment due before ${end} is already paid.` }
}

/** The first payments of the next month, so a quiet month doesn't look like a free one. */
function nextMonth(data: Recurring) {
  const edge = addDays(data.end_date, 7)
  const soon = data.items
    .filter(i => (i.state === 'paid' || i.state === 'later') && i.next_date && i.next_date > data.end_date && i.next_date <= edge)
    .sort((a, b) => a.next_date!.localeCompare(b.next_date!))
  if (soon.length === 0) return null
  const first = soon[0].next_date!
  const last = soon[soon.length - 1].next_date!
  const span = daysBetween(first, last) + 1
  const total = soon.reduce((sum, i) => sum + i.amount_cents, 0)
  return `From ${dayLabel(addDays(data.end_date, 1))}: ${list(soon.map(i => i.name))}, ${formatEuros(total)} ${
    span > 1 ? `in ${words(span)} days` : `on ${dayLabel(first)}`}.`
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** The repeating payments for one financial month, as a bottom sheet on a phone and a card on a desktop. */
export default function RecurringSheet({ data, onClose }: { data: Recurring; onClose: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const toggle = (key: string) => setOpenKey(k => (k === key ? null : key))
  const qc = useQueryClient()
  const count = async (item: RecurringItem, counted: boolean) => {
    await (counted ? api.countBillAgain(item.key) : api.ignoreBill(item.key))
    qc.invalidateQueries({ queryKey: ['recurring'] })
    qc.invalidateQueries({ queryKey: ['pace'] })
  }

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('.tx-close')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab' || !sheet.current) return
      const stops = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const of = (state: RecurringItem['state']) => data.items.filter(i => i.state === state)
  const due = of('due')
  const expected = of('expected')
  const paid = of('paid')
  const stopped = data.status === 'ok' ? of('stopped') : []
  const { head, sub } = lead(data, due, expected)
  const later = data.status === 'ok' ? nextMonth(data) : null

  const group = (title: string, items: RecurringItem[], kind: 'due' | 'expected' | 'paid' | 'stopped' | 'ignored') =>
    items.length > 0 && (
      <div className="rc-group">
        <h3 className="lab">{title}</h3>
        <ul className="rc-list">
          {items.map(item => (
            <Row key={item.key} item={item} kind={kind} data={data} open={openKey === item.key} onToggle={() => toggle(item.key)} onCount={count} />
          ))}
        </ul>
      </div>
    )

  return (
    <div className="scrim" onClick={onClose}>
      <section
        ref={sheet}
        className="sheet rc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Recurring payments"
        onClick={e => e.stopPropagation()}
      >
        <div className="tx-sheet-head">
          <h2>Recurring payments</h2>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="rc-lead">{head}</p>
        <p className="rc-sub">{sub}</p>
        {group('Still to pay', due, 'due')}
        {group('Expected', expected, 'expected')}
        {group(data.status === 'gap' && data.data_through ? `Paid up to ${dayLabel(data.data_through)}` : 'Paid this month', paid, 'paid')}
        {later && <p className="rc-next">{later}</p>}
        {group('Stopped?', stopped, 'stopped')}
        {group('Not counted as fixed bills', of('ignored'), 'ignored')}
      </section>
    </div>
  )
}
