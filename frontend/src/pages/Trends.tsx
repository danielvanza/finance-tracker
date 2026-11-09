import { useState, type ComponentProps } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, LabelList, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { formatCents, formatEuros } from '../money'
import type { DashboardSummary, Pace, TrendMonth } from '../types'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import GoalsSection from '../components/goals/GoalsSection'
import Movers from './trends/Movers'
import { trendFacts } from './trends/facts'
import { monthName } from './trends/months'
import { useRem } from './trends/useRem'

const MONTHS_SHOWN = 6
const OTHER_BELOW = 0.02 // categories under 2% of spending fold into "Other"

// Fixed order, one colour per kind of spending, on every chart and in every month.
const SERIES = [
  { key: 'needs_cents', kind: 'needs', label: 'Needs' },
  { key: 'wants_cents', kind: 'wants', label: 'Wants' },
  { key: 'savings_cents', kind: 'savings', label: 'Savings' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']
type Kind = (typeof SERIES)[number]['kind'] | 'other'

const seriesColour = (kind: Kind) => `var(--series-${kind})`

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Row extends TrendMonth {
  label: string
  hasData: boolean
  finished: boolean // false while the month runs or the bank files don't reach its end yet
}

function toRows(series: TrendMonth[], pace: Pace): Row[] {
  return series.map(m => ({
    ...m,
    label: monthName(m.month, 'short'),
    hasData: m.total_expenses_cents !== 0 || m.total_income_cents !== 0,
    finished: m.month < pace.current_month && !pace.behind_months.includes(m.month),
  }))
}

/** One sentence on whether spending is coming down, from finished months only. */
function trendFinding(rows: Row[]) {
  const finished = rows.filter(r => r.hasData && r.finished)
  if (finished.length === 0) return 'There is no finished month to compare yet.'
  const last = finished[finished.length - 1]
  const lastName = monthName(last.month, 'long')
  if (finished.length === 1) return `${lastName} is the only finished month so far, so there is nothing to compare it with yet.`
  const before = finished[finished.length - 2]
  const beforeName = monthName(before.month, 'long')
  const spendable = (r: Row) => r.needs_cents + r.wants_cents
  const delta = spendable(last) - spendable(before)
  if (Math.abs(delta) < spendable(before) / 100) return `Needs and wants were about the same in ${lastName} as in ${beforeName}.`
  return `Needs and wants came to ${formatEuros(Math.abs(delta))} ${delta < 0 ? 'less' : 'more'} in ${lastName} than in ${beforeName}.`
}

interface CategoryItem {
  name: string
  value: number
  kind: Kind
  pct: string
}

function categoryItems(summary: DashboardSummary): CategoryItem[] {
  const total = summary.total_expenses_cents || 1
  const share = (cents: number) => String(Math.round((cents / total) * 1000) / 10)
  const spent = summary.category_breakdown.filter(c => c.actual_cents > 0)
  const items: CategoryItem[] = spent
    .filter(c => c.actual_cents / total >= OTHER_BELOW)
    .sort((a, b) => b.actual_cents - a.actual_cents)
    .map(c => ({ name: c.category_name, value: c.actual_cents, kind: c.type as Kind, pct: share(c.actual_cents) }))
  const otherTotal = spent.filter(c => c.actual_cents / total < OTHER_BELOW).reduce((s, c) => s + c.actual_cents, 0)
  if (otherTotal > 0) items.push({ name: 'Other', value: otherTotal, kind: 'other', pct: share(otherTotal) })
  return items
}

function Legend({ kinds }: { kinds: readonly Kind[] }) {
  const labelOf = (kind: Kind) => SERIES.find(s => s.kind === kind)?.label ?? 'Other'
  return (
    <ul className="trend-legend">
      {kinds.map(kind => (
        <li key={kind}><i className={`is-${kind}`} aria-hidden="true" />{labelOf(kind)}</li>
      ))}
    </ul>
  )
}

interface TipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: Row }>
}

function TrendTip({ active, payload }: TipProps) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="trend-tip">
      <span className="lab">{monthName(row.month, 'long')}</span>
      {row.hasData
        ? <>
            {SERIES.map(s => (
              <div key={s.key}>
                <i className={`is-${s.kind}`} aria-hidden="true" />
                <strong>{formatCents(row[s.key])}</strong>
                <span>{s.label}</span>
              </div>
            ))}
            <div className="trend-tip-total"><strong>{formatCents(row.total_expenses_cents)}</strong><span>All spending</span></div>
          </>
        : <div><span>No spending recorded</span></div>}
    </div>
  )
}

interface LabelArgs {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  index?: number
}

// Under this plot width the axis and series names no longer fit beside the columns.
const COMPACT_BELOW_REM = 14

function SpendingChart({ rows, compact, onResize }: { rows: Row[]; compact: boolean; onResize: (width: number) => void }) {
  const lastIndex = rows.reduce((found, r, i) => (r.hasData ? i : found), -1)
  const topKey = (r: Row): SeriesKey | undefined => [...SERIES].reverse().find(s => r[s.key] > 0)?.key

  // Names sit beside the latest column; a segment too thin to hold one relies on the legend.
  const nameLabel = (label: string) => ({ x, y, width, height, index }: LabelArgs) => {
    if (compact || index !== lastIndex || Number(height) < 12) return null
    return (
      <text className="trend-name" x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2} dominantBaseline="central">
        {label}
      </text>
    )
  }
  const totalLabel = ({ x, y, width, index }: LabelArgs) => {
    if (index !== lastIndex) return null
    return (
      <text className="trend-total" x={Number(x) + Number(width) / 2} y={Number(y) - 7} textAnchor="middle">
        {formatEuros(rows[index].total_expenses_cents)}
      </text>
    )
  }

  return (
    <div className="trend-plot">
      <ResponsiveContainer width="100%" height="100%" onResize={width => onResize(width)}>
        <BarChart data={rows} margin={{ top: 22, right: compact ? 20 : 56, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false} />
          {compact
            ? <YAxis hide />
            : <YAxis width={48} tickCount={4} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatEuros(v)} />}
          <Tooltip content={tip => <TrendTip active={tip.active} payload={tip.payload as TipProps['payload']} />} cursor={{ fill: 'var(--press-tint)' }} isAnimationActive={false} />
          {SERIES.map(s => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="spending"
              maxBarSize={24}
              fill={seriesColour(s.kind)}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              shape={(bar: unknown) => {
                const props = bar as ComponentProps<typeof Rectangle> & { payload: Row }
                if (!props.height) return <g />
                const top = topKey(props.payload) === s.key
                return <Rectangle {...props} radius={top ? [4, 4, 0, 0] : 0} fillOpacity={props.payload.finished ? 1 : 0.5} />
              }}
            >
              <LabelList content={nameLabel(s.label)} />
              {s.key === 'savings_cents' && <LabelList content={totalLabel} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function LastMonths({ rows }: { rows: Row[] }) {
  const rem = useRem()
  const [plotWidth, setPlotWidth] = useState<number>()
  const compact = plotWidth !== undefined && plotWidth / rem < COMPACT_BELOW_REM
  // Compact: months before the first one with spending are dropped, and the names shortened to three letters.
  const firstWithData = rows.findIndex(r => r.hasData)
  const shown = compact ? rows.slice(firstWithData).map(r => ({ ...r, label: r.label.slice(0, 3) })) : rows
  const facts = trendFacts(rows)
  return (
    <section className="section">
      <h2>{compact && shown.length !== rows.length ? (shown.length > 1 ? `Last ${shown.length} months` : 'Latest month') : `Last ${MONTHS_SHOWN} months`}</h2>
      <div className="panel">
        <p className="trend-finding">{trendFinding(rows)}</p>
        {facts.length > 0 && (
          <ul className="trend-facts">
            {facts.map(f => (
              <li key={f.label}><span className="lab">{f.label}</span><span>{f.text}</span></li>
            ))}
          </ul>
        )}
        <Legend kinds={SERIES.map(s => s.kind)} />
        <SpendingChart rows={shown} compact={compact} onResize={setPlotWidth} />
        {rows.some(r => r.hasData && !r.finished) && <p className="trend-note">Paler months are not finished yet.</p>}
        <Figures rows={rows} />
      </div>
    </section>
  )
}

function Figures({ rows }: { rows: Row[] }) {
  return (
    <details className="trend-figures">
      <summary>Figures<ChevronDown size={16} aria-hidden="true" /></summary>
      <table className="table trend-table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            {SERIES.map(s => <th scope="col" className="right" key={s.key}>{s.label}</th>)}
            <th scope="col" className="right">All</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.month}>
              <td>{r.label}</td>
              {r.hasData
                ? <>
                    {SERIES.map(s => <td className="right num" key={s.key}>{formatEuros(r[s.key])}</td>)}
                    <td className="right num strong">{formatEuros(r.total_expenses_cents)}</td>
                  </>
                : <td className="right muted" colSpan={4}>No spending recorded</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Categories({ summary }: { summary: DashboardSummary }) {
  const items = categoryItems(summary)
  if (items.length === 0) return <p className="empty">No spending recorded for this month.</p>
  const top = items.find(i => i.kind !== 'other') ?? items[0]
  const largest = Math.max(...items.map(i => i.value))
  const kinds: Kind[] = [...SERIES.map(s => s.kind), 'other'].filter(k => items.some(i => i.kind === k)) as Kind[]
  return (
    <>
      <p className="trend-finding">{top.name} took the most: {Math.round(Number(top.pct))}% of the month's spending.</p>
      <p className="trend-note">Share of all spending · {items.length} categor{items.length === 1 ? 'y' : 'ies'}</p>
      <Legend kinds={kinds} />
      <ul className="trend-cats">
        {items.map(item => (
          <li key={item.name}>
            <span className="trend-cat-name">{item.name}</span>
            <span className="num">{formatCents(item.value)}</span>
            <span className="num muted trend-cat-pct">{item.pct}%</span>
            <span className="meter" aria-hidden="true">
              <i className={`is-${item.kind}`} style={{ width: `${(item.value / largest) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function Trends() {
  const [picked, setPicked] = useState<string | undefined>()

  const paceQuery = useQuery({
    queryKey: ['pace', picked ?? 'current'],
    queryFn: () => api.getPace(picked),
    placeholderData: keepPreviousData,
  })
  const p = paceQuery.data
  const month = p?.month
  const trendsQuery = useQuery({
    queryKey: ['trends', month],
    queryFn: () => api.getTrends(MONTHS_SHOWN, month!),
    enabled: !!month,
    placeholderData: keepPreviousData,
  })
  const summaryQuery = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month!),
    enabled: !!month,
    placeholderData: keepPreviousData,
  })

  const failed = paceQuery.error ?? trendsQuery.error ?? summaryQuery.error
  if (failed) return <ErrorBanner message={describeApiError(failed)} />

  const trends = trendsQuery.data
  const summary = summaryQuery.data
  if (!p || !month || !trends || !summary) {
    return (
      <div aria-busy="true" aria-label="Loading trends">
        <span className="skeleton trend-skeleton-head" />
        <span className="skeleton trend-skeleton-chart" />
      </div>
    )
  }

  const rows = toRows(trends.series, p)
  const anyData = rows.some(r => r.hasData)
  const refreshing = paceQuery.isPlaceholderData || trendsQuery.isPlaceholderData || summaryQuery.isPlaceholderData

  return (
    <>
      <div className="month-bar">
        <span className="lab">{dayLabel(p.start_date)} – {dayLabel(p.end_date)}</span>
        <div className="month-nav">
          <button type="button" className="btn" aria-label="Previous month" onClick={() => setPicked(shiftMonth(month, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Next month"
            disabled={month === p.current_month}
            onClick={() => setPicked(shiftMonth(month, 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <h1>Trends</h1>

      {!anyData ? (
        <p className="empty">No months of spending yet. Bring in a file from a bank to see the trend.</p>
      ) : (
        <div className={`trends-grid${refreshing ? ' is-refreshing' : ''}`}>
          <div className="trends-col">
            <LastMonths rows={rows} />
            <Movers month={month} summary={summary} rows={rows} />
          </div>

          <div className="trends-col">
            <section className="section">
              <h2>By category</h2>
              <div className="panel">
                <Categories summary={summary} />
              </div>
            </section>
            <GoalsSection />
          </div>
        </div>
      )}
    </>
  )
}
