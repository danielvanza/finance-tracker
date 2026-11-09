import { Check } from 'lucide-react'
import { dayLabel } from '../../dates'
import type { Pace } from '../../types'
import { BANKS } from './bank'
import { catchupProgress, type CatchupPath } from './catchup'
import { lastDates } from './freshness'

const WORDS = ['No', 'One', 'Two', 'Three']

interface Props {
  path: CatchupPath
  pace: Pace | undefined
  /** Banks imported on this visit. */
  imported: string[]
}

/** A short path above the page for picking up after a gap: the banks behind, the review, the month. */
export default function Catchup({ path, pace, imported }: Props) {
  const { done, current } = catchupProgress(path, pace ?? null, imported)
  const last = lastDates(pace)
  const left = done.filter(d => !d).length
  const review = pace?.to_review ?? 0

  const steps: Array<{ name: string; note: string; done: boolean }> = path.empty
    ? [{ name: 'A bank file', note: 'none yet', done: done[0] }]
    : path.banks.map((s, i) => ({ name: BANKS[s], note: `to ${dayLabel(last[s] as string)}`, done: done[i] }))
  steps.push({ name: 'Review', note: pace ? (review > 0 ? `${review} to look at` : 'nothing to look at') : '', done: left === 0 && review === 0 })
  steps.push({ name: 'The month', note: 'where you stand', done: false })

  const doneNames = path.empty ? [] : path.banks.filter((_, i) => done[i]).map(s => BANKS[s])
  const title = path.empty && left > 0
    ? 'No bank files yet'
    : left === 0
      ? 'Almost there'
      : doneNames.length === 0
        ? (path.from ? `From ${dayLabel(path.from)}` : 'Picking up')
        : left === 1 ? 'One bank to go' : `${WORDS[left] ?? left} banks to go`
  const nextName = !path.empty && left > 0 ? BANKS[path.banks[done.indexOf(false)]] : null
  const line = left === 0
    ? `${path.empty ? 'The file is in.' : 'Every bank is in.'} ${review > 0 ? 'Last, a look at what needs sorting.' : 'Nothing left to sort. Last, see where the month stands.'}`
    : path.empty
      ? 'Bring in a file from each bank you use, sort what needs a look, then see the month.'
      : doneNames.length > 0
        ? `${doneNames.join(' and ')} ${doneNames.length === 1 ? 'is' : 'are'} in. ${nextName} next.`
        : `${WORDS[left] ?? left} ${left === 1 ? 'bank stops' : 'banks stop'} before today. Bring in each file, sort what needs a look, then see the month.`

  return (
    <section className="panel import-path" aria-labelledby="import-path-title">
      <h2 id="import-path-title" className="lab">Picking up</h2>
      <p className="import-path-title">{title}</p>
      <p className="import-path-line">{line}</p>
      <ol style={{ '--steps': steps.length } as React.CSSProperties}>
        {steps.map((s, i) => (
          <li key={s.name} className={s.done ? 'is-done' : undefined} aria-current={i === current ? 'step' : undefined}>
            <span className="row">
              <span className="mark">{s.done ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
              <span>{s.name}</span>
            </span>
            <small className="num">{s.note}</small>
          </li>
        ))}
      </ol>
    </section>
  )
}
