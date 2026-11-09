import { Check } from 'lucide-react'
import { dayLabel } from '../../dates'
import type { Pace } from '../../types'
import { BANKS, SOURCES } from './bank'
import { bankHint, lastDates, movedBanks } from './freshness'

interface Props {
  source: string
  onPick: (source: string) => void
  pace: Pace | undefined
  /** The pace as it was when the page opened, to show what this visit changed. */
  snapshot: Pace | null
}

/** Step 1: each bank with its last row, and one line on where the chosen bank stands. */
export default function BankStep({ source, onPick, pace, snapshot }: Props) {
  const last = lastDates(pace)
  const moved = snapshot ? movedBanks(pace, snapshot) : []
  return (
    <section className="panel import-step" aria-labelledby="import-step-bank">
      <h2 id="import-step-bank"><span className="import-num">1</span> Choose the bank</h2>
      <div className="seg import-banks" role="group" aria-labelledby="import-step-bank">
        {SOURCES.map(s => (
          <button key={s} type="button" aria-pressed={source === s} onClick={() => onPick(s)}>
            <span>{BANKS[s]}</span>
            {' '}
            {pace && (
              <small className="num">
                {moved.includes(s) && <Check size={12} aria-hidden="true" />}
                {last[s] ? dayLabel(last[s] as string) : 'no file'}
              </small>
            )}
          </button>
        ))}
      </div>
      {pace && <p className="import-hint">{bankHint(source, pace, snapshot)}</p>}
    </section>
  )
}
