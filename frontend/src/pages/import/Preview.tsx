import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { dayLabel } from '../../dates'
import { formatCents } from '../../money'
import type { ImportPreviewResponse, ImportPreviewRow, Pace } from '../../types'
import { BANKS, sniffBank } from './bank'
import { lastDates } from './freshness'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3 – 9 Nov", "28 Oct – 9 Nov", "9 Nov". */
function coverage(rows: ImportPreviewRow[]) {
  const dates = rows.map(r => r.date).sort()
  const a = dayLabel(dates[0])
  const b = dayLabel(dates[dates.length - 1])
  if (a === b) return b
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]} – ${b}` : `${a} – ${b}`
}

function Rows({ rows, label }: { rows: ImportPreviewRow[]; label: string }) {
  return (
    <table className="table card-table import-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th className="right">Amount</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.duplicate ? 'is-duplicate' : undefined}>
            <td className="num import-date">{r.date}</td>
            <td className="strong import-desc" title={r.description}>{r.description}</td>
            <td className={`right strong num import-amount${r.amount_cents < 0 ? '' : ' is-in'}`}>
              {r.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(r.amount_cents))}
            </td>
            <td className="import-status">{label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Props {
  preview: ImportPreviewResponse
  source: string
  file: File | null
  pace: Pace | undefined
  busy: boolean
  loading: boolean
  onConfirm: () => void
  onAnother: () => void
  onReadAs: (bank: string) => void
}

/** Step 3: the head says what to do next; new rows come first and rows already in fold away. */
export default function Preview({ preview, source, file, pace, busy, loading, onConfirm, onAnother, onReadAs }: Props) {
  const rows = preview.rows
  const fresh = rows.filter(r => !r.duplicate)
  const seen = rows.filter(r => r.duplicate)
  const bank = BANKS[source]

  // Only an empty preview asks the file which bank it belongs to.
  const [looksLike, setLooksLike] = useState<string | null>(null)
  useEffect(() => {
    if (rows.length > 0 || !file) return
    let live = true
    sniffBank(file).then(b => { if (live) setLooksLike(b && b !== source ? b : null) })
    return () => { live = false }
  }, [rows.length, file, source])

  let title: string
  let say: React.ReactNode
  let action: React.ReactNode
  if (rows.length === 0) {
    title = `No ${bank} rows in this file`
    say = looksLike
      ? <>It looks like a <strong>{BANKS[looksLike]}</strong> export, so nothing could be read as {bank}.</>
      : <>Check the bank matches the file, then try again.</>
    action = looksLike
      ? <button type="button" className="btn btn-primary" onClick={() => onReadAs(looksLike)} disabled={loading}>Read it as {BANKS[looksLike]}</button>
      : <button type="button" className="btn" onClick={onAnother}>Choose another file</button>
  } else if (fresh.length === 0) {
    const reaches = lastDates(pace)[source]
    const end = rows.map(r => r.date).sort().pop() as string
    title = 'Nothing new in this file'
    say = (
      <>
        {rows.length === 1 ? 'The row is already in.' : `All ${rows.length} rows are already in.`}
        {' '}The file covers {coverage(rows)}
        {reaches && reaches >= end ? ` and ${bank} already reaches ${dayLabel(reaches)}.` : '.'}
      </>
    )
    action = <button type="button" className="btn" onClick={onAnother}>Choose another file</button>
  } else {
    title = `${fresh.length} new to add`
    say = (
      <>
        <span className="import-new">{fresh.length} new</span>
        {seen.length > 0 && `, ${seen.length} already in`}. The file covers {coverage(rows)}.
      </>
    )
    action = (
      <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading}>
        {busy ? (
          <>
            <LoaderCircle size={16} className="import-spin" aria-hidden="true" />
            Importing…
          </>
        ) : (
          `Import ${plural(fresh.length, 'new transaction')}`
        )}
      </button>
    )
  }

  return (
    <section className="panel import-preview" aria-labelledby="import-step-confirm">
      <div className="import-preview-head">
        <div>
          <h2 id="import-step-confirm">{title}</h2>
          <p className="import-say num">{say}</p>
        </div>
        {action}
      </div>
      {fresh.length > 0 && <Rows rows={fresh} label="new" />}
      {seen.length > 0 && (
        <details className="import-fold">
          <summary>Show the {plural(seen.length, 'row')} already in</summary>
          <Rows rows={seen} label="already in" />
        </details>
      )}
    </section>
  )
}
