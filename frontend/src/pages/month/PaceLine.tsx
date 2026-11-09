import { useState, type PointerEvent } from 'react'
import { dayLabel } from '../../dates'
import { formatEuros } from '../../money'
import type { Pace } from '../../types'

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The month as one line: the plan dashed, spending solid, today as the sun. */
export default function PaceLine({ pace }: { pace: Pace }) {
  const [hover, setHover] = useState<number | null>(null)
  const { daily, days_total: total, spendable_plan_cents: plan, day_number: dayNumber } = pace
  const lastDay = total - 1

  const top = Math.max(plan, ...daily.map(d => d.cumulative_cents), 1) * 1.04
  const x = (day: number) => (day / lastDay) * 100
  const y = (cents: number) => 100 - (Math.max(cents, 0) / top) * 100
  const planAt = (day: number) => Math.floor((plan * (day + 1)) / total)

  const today = dayNumber === null ? null : dayNumber - 1
  // While the files reach today or yesterday the line runs on to today and the sun sits on it.
  // When they stop earlier the line stops there too, and today is a hollow mark on the plan.
  const lastSpent = daily[daily.length - 1]?.cumulative_cents
  const reachesToday = today !== null && daily.length > 0 && daily.length >= today
  const points = daily.map((d, i) => `${x(i)},${y(d.cumulative_cents)}`)
  if (reachesToday && daily.length - 1 < today) points.push(`${x(today)},${y(lastSpent)}`)
  const spent = points.join(' ')
  const nowY = today === null ? 0 : reachesToday ? y(lastSpent) : y(planAt(today))
  const nowX = today === null ? 0 : x(today)

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const day = Math.round(((e.clientX - box.left) / box.width) * lastDay)
    setHover(Math.min(lastDay, Math.max(0, day)))
  }

  const hovered = hover === null ? null : daily[hover]
  const summary = pace.status === 'ok'
    ? `Spending so far is ${formatEuros(pace.spendable_actual_cents)} against a plan of ${formatEuros(plan)} for the month.`
    : `The plan is ${formatEuros(plan)} for the month. No spending is recorded yet.`
  const showToday = today !== null && x(today) > 14 && x(today) < 86

  return (
    <div className="pace">
      <div className="pace-plot" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={summary}>
          <line className="pace-plan" x1="0" y1={y(0)} x2="100" y2={y(plan)} />
          {points.length > 1 && <polyline className="pace-spent" points={spent} />}
        </svg>
        {today !== null && (
          <span className={`pace-now${reachesToday ? '' : ' is-open'}`} style={{ left: `${nowX}%`, top: `${nowY}%` }} />
        )}
        {hover !== null && (
          <>
            <span className="pace-cross" style={{ left: `${x(hover)}%` }} />
            <div className="pace-tip" style={x(hover) > 55 ? { right: `${100 - x(hover) + 2}%` } : { left: `${x(hover) + 2}%` }}>
              <strong>{dayLabel(addDays(pace.start_date, hover))}</strong>
              {hovered && <>Spent {formatEuros(hovered.cumulative_cents)}<br /></>}
              Plan by then {formatEuros(planAt(hover))}
            </div>
          </>
        )}
      </div>
      <div className="pace-axis" aria-hidden="true">
        <span style={{ left: 0 }}>{dayLabel(pace.start_date)}</span>
        {showToday && <span style={{ left: `${x(today)}%`, transform: 'translateX(-50%)' }}>today</span>}
        <span style={{ right: 0 }}>{dayLabel(pace.end_date)}</span>
      </div>
    </div>
  )
}
