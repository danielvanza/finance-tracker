import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dayLabel } from '../../dates'
import { formatEuros } from '../../money'
import type { Pace } from '../../types'

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The month as one line: the plan dashed, spending solid over a fading area, the last day the files show a dot with a pill saying over or under pace; the line turns amber when over. */
export default function PaceLine({ pace }: { pace: Pace }) {
  const [hover, setHover] = useState<number | null>(null)
  const { daily, days_total: total, spendable_plan_cents: plan, day_number: dayNumber } = pace
  const lastDay = total - 1

  const top = Math.max(plan, ...daily.map(d => d.cumulative_cents), 1) * 1.04
  const x = (day: number) => (day / lastDay) * 100
  const y = (cents: number) => 100 - (Math.max(cents, 0) / top) * 100
  const planAt = (day: number) => Math.floor((plan * (day + 1)) / total)

  const today = dayNumber === null ? null : dayNumber - 1
  // While the files reach today or yesterday the line runs on to today and the dot sits on it.
  // When they stop earlier the line stops there too, today is a plain mark across the plot (nothing is
  // guessed for the days between), and the verdict is said for the last day the files show.
  const lastIndex = daily.length - 1
  const lastSpent = daily[lastIndex]?.cumulative_cents
  const reachesToday = today !== null && daily.length > 0 && daily.length >= today
  const points = daily.map((d, i) => `${x(i)},${y(d.cumulative_cents)}`)
  if (reachesToday && lastIndex < today) points.push(`${x(today)},${y(lastSpent)}`)
  const spent = points.join(' ')
  const lastX = points.length > 0 ? Number(points[points.length - 1].split(',')[0]) : 0
  const area = points.length > 1 ? `0,100 ${spent} ${lastX},100` : ''
  const delta = reachesToday ? pace.pace_delta_cents : daily.length > 0 ? lastSpent - planAt(lastIndex) : null
  const by = reachesToday || lastIndex < 0 ? '' : ` by ${dayLabel(addDays(pace.start_date, lastIndex))}`
  const verdict = pace.status === 'ok' && today !== null && delta !== null && plan > 0
    ? { over: delta > 0, text: delta > 0 ? `${formatEuros(delta)} over pace${by}` : delta < 0 ? `${formatEuros(-delta)} under pace${by}` : `On pace${by}` }
    : null
  const markX = reachesToday ? x(today!) : lastX
  const markY = reachesToday ? y(lastSpent) : daily.length > 0 ? y(lastSpent) : 100

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const day = Math.round(((e.clientX - box.left) / box.width) * lastDay)
    setHover(Math.min(lastDay, Math.max(0, day)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (step) {
      e.preventDefault()
      setHover(h => Math.min(lastDay, Math.max(0, (h ?? Math.max(lastIndex, 0)) + step)))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setHover(e.key === 'Home' ? 0 : lastDay)
    } else if (e.key === 'Escape') setHover(null)
  }

  const hovered = hover === null ? null : daily[hover]
  const tipText = hover === null ? '' : `${dayLabel(addDays(pace.start_date, hover))}: ${hovered ? `spent ${formatEuros(hovered.cumulative_cents)}, ` : ''}plan by then ${formatEuros(planAt(hover))}`
  const summary = pace.status === 'ok'
    ? `Spending so far is ${formatEuros(pace.spendable_actual_cents)} against a plan of ${formatEuros(plan)} for the month${verdict ? `, ${verdict.text}` : ''}.`
    : `The plan is ${formatEuros(plan)} for the month. No spending is recorded yet.`
  // The axis says "today" only where it cannot run into the first or last date.
  const showToday = today !== null && x(today) > 16 && x(today) < 78

  return (
    <div className={`pace${verdict?.over ? ' is-over' : ''}`}>
      <div
        className="pace-plot"
        tabIndex={0}
        role="group"
        aria-label={`${summary} Arrow keys read the line day by day.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="pace-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="pace-fade-top" />
              <stop offset="1" className="pace-fade-end" />
            </linearGradient>
          </defs>
          <line className="pace-plan" x1="0" y1={y(0)} x2="100" y2={y(plan)} />
          {area && <polygon className="pace-area" points={area} fill="url(#pace-fade)" />}
          {points.length > 1 && <polyline className="pace-spent" points={spent} />}
        </svg>
        {today !== null && !reachesToday && (
          <span className={`pace-today${x(today) > 70 ? ' is-end' : ''}`} style={{ left: `${x(today)}%` }}><span>today</span></span>
        )}
        {today !== null && daily.length > 0 && (
          <span className={`pace-now${reachesToday ? '' : ' is-last'}`} style={{ left: `${markX}%`, top: `${markY}%` }} />
        )}
        {verdict && hover === null && (
          <span
            className={`pace-pill ${verdict.over ? 'is-over' : 'is-under'}`}
            style={markX > 60 ? { right: `${100 - markX}%`, top: `${markY}%` } : { left: `${markX}%`, top: `${markY}%` }}
          >
            {verdict.text}
          </span>
        )}
        {hover !== null && (
          <>
            <span className="pace-cross" style={{ left: `${x(hover)}%` }} />
            <div className="pace-tip" aria-hidden="true" style={x(hover) > 55 ? { right: `${100 - x(hover) + 2}%` } : { left: `${x(hover) + 2}%` }}>
              <strong>{dayLabel(addDays(pace.start_date, hover))}</strong>
              {hovered && <>Spent {formatEuros(hovered.cumulative_cents)}<br /></>}
              Plan by then {formatEuros(planAt(hover))}
            </div>
          </>
        )}
        <span className="sr-only" aria-live="polite">{tipText}</span>
      </div>
      <div className="pace-axis" aria-hidden="true">
        <span style={{ left: 0 }}>{dayLabel(pace.start_date)}</span>
        {showToday && reachesToday && <span style={{ left: `${x(today!)}%`, transform: 'translateX(-50%)' }}>today</span>}
        <span style={{ right: 0 }}>{dayLabel(pace.end_date)}</span>
      </div>
    </div>
  )
}
