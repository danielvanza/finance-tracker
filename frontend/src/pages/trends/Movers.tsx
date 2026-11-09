import { useQueries } from '@tanstack/react-query'
import { api } from '../../api'
import { formatEuros } from '../../money'
import type { DashboardSummary } from '../../types'
import { monthName, nameList } from './months'
import { earlierMonths, findMovers, moversHeadline } from './movers'

interface Props {
  month: string
  summary: DashboardSummary // the picked month, already loaded by the page
  rows: Array<{ month: string; hasData: boolean; finished: boolean }>
}

/** The biggest movers against the usual month. Says nothing until the picked month is finished and has an earlier one. */
export default function Movers({ month, summary, rows }: Props) {
  const months = earlierMonths(rows, month)
  const queries = useQueries({
    queries: months.map(m => ({ queryKey: ['dashboard', m], queryFn: () => api.getDashboard(m) })),
  })
  if (months.length === 0 || queries.some(q => !q.data)) return null
  const movers = findMovers(summary, queries.map(q => q.data as DashboardSummary))
  if (movers.length === 0) return null

  return (
    <section className="section">
      <h2>What moved in {monthName(month, 'long')}</h2>
      <div className="panel">
        <p className="trend-finding">{moversHeadline(movers)}</p>
        <p className="trend-note">
          Against {months.length === 1 ? nameList(months) : `the average of ${nameList(months)}`}.
        </p>
        <ul className="trend-movers">
          {movers.map(m => (
            <li key={m.id}>
              <div className="mv-line">
                <span className="mv-name">{m.name}</span>
                <strong className="mv-d num">{m.delta < 0 ? '\u2212' : '+'}{formatEuros(Math.abs(m.delta))}</strong>
              </div>
              <div className="mv-line mv-quiet">
                <span className="mv-sub">{formatEuros(m.now)} against {formatEuros(m.avg)} on average</span>
                <span className="mv-p">{m.pct}% {m.delta < 0 ? 'below' : 'above'}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
