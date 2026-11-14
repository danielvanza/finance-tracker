import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Copy, Download, Printer } from 'lucide-react'
import { api } from '../../api'
import { formatCents, formatEuros } from '../../money'
import ErrorBanner, { describeApiError } from '../ErrorBanner'
import { csvFilename, downloadCsv } from './csv'
import {
  buildReport, footerText, isQuiet, longDate, meterPct, moveRange, moveText, planText, reportText, shiftMonth, sinceText, spentText,
} from './model'
import type { CsvTransaction, Report, ReportGroup } from './types'
import '../../styles/reports.css'

/**
 * The month report at `/report?month=YYYY-MM`: one A4 statement of the month (the verdict, the plan by kind and
 * category, what moved since the month before, the whole month). Without `?month=` it shows the current financial
 * month. It takes no props. On paper it drops the app's chrome and uses the system's paper colours in both themes.
 */
export default function ReportPage() {
  const [params, setParams] = useSearchParams()
  const [moved, setMoved] = useState(false)
  const asked = params.get('month') ?? undefined
  const previous = asked ? shiftMonth(asked, -1) : undefined

  const paceQuery = useQuery({ queryKey: ['pace', asked ?? 'current'], queryFn: () => api.getPace(asked) })
  const month = paceQuery.data?.month
  const before = month ? shiftMonth(month, -1) : previous

  const budget = useQuery({ queryKey: ['budget', month], queryFn: () => api.getBudget(month!), enabled: !!month })
  const summary = useQuery({ queryKey: ['dashboard', month], queryFn: () => api.getDashboard(month!), enabled: !!month })
  const prevSummary = useQuery({ queryKey: ['dashboard', before], queryFn: () => api.getDashboard(before!), enabled: !!before })
  const prevPace = useQuery({ queryKey: ['pace', before], queryFn: () => api.getPace(before), enabled: !!before })
  const transactions = useQuery({ queryKey: ['transactions', { month }], queryFn: () => api.getTransactions({ month: month! }), enabled: !!month })

  const pace = paceQuery.data
  const report = useMemo(
    () => pace && budget.data && summary.data
      ? buildReport({
        pace,
        budget: budget.data,
        summary: summary.data,
        previous: prevSummary.data && prevPace.data ? { summary: prevSummary.data, pace: prevPace.data } : undefined,
        transactions: transactions.data,
      })
      : undefined,
    [pace, budget.data, summary.data, prevSummary.data, prevPace.data, transactions.data],
  )

  // "Save as PDF" names the file after the page title.
  useEffect(() => {
    if (!report) return
    const old = document.title
    document.title = `Finances, ${report.period}`
    return () => { document.title = old }
  }, [report])

  const failed = paceQuery.error ?? budget.error ?? summary.error
  if (failed) return <ErrorBanner title="The report didn't load" message={describeApiError(failed)} />
  if (!pace || !report) {
    return (
      <div aria-busy="true" aria-label="Loading the report">
        <span className="skeleton month-skel-head" />
        <span className="skeleton month-skel-plot" />
      </div>
    )
  }

  const isCurrent = pace.month === pace.current_month
  const go = (m: string) => setParams({ month: m })

  return (
    <article className="report">
      <div className="rep-printhead">
        <span className="rep-brand">Finances</span>
        <span className="lab">Month report · {longDate(new Date())}</span>
      </div>

      <div className="month-bar">
        <span className="lab">{report.period}{report.dayNote && <span className="month-day"> · {report.dayNote}</span>}</span>
        <div className="month-nav">
          <button type="button" className="btn" aria-label="Previous month" onClick={() => go(shiftMonth(pace.month, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" className="btn" aria-label="Next month" disabled={isCurrent} onClick={() => go(shiftMonth(pace.month, 1))}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="verdict">
        <h1 className={report.status === 'ok' ? undefined : 'is-unknown'}>{report.headline}</h1>
        <p>{report.sentence}</p>
      </div>

      <Actions report={report} rows={transactions.data} />

      {report.kinds.length > 0 && (
        <section className="section rep-plan-sec">
          <h2>Against the plan</h2>
          <div className="panel kinds">
            {report.kinds.map(k => (
              <div className="kind" key={k.kind}>
                <span>{k.label}</span>
                <small>{formatEuros(k.spent)} of {formatEuros(k.plan)}</small>
                <span className="meter" aria-hidden="true"><i style={{ width: `${meterPct(k.spent, k.plan)}%` }} /></span>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.groups.length > 0 && (
        <section className="section">
          <h2>By category</h2>
          <div className="rep-cats">
            {report.groups.map(g => <Group key={g.kind} group={g} since={report.compare?.short ?? null} />)}
          </div>
        </section>
      )}

      {report.compare && (report.more.length > 0 || report.less.length > 0) && (
        <section className={`section rep-moved${moved ? ' is-open' : ''}`}>
          <h2>
            <button type="button" className="rep-fold" aria-expanded={moved} aria-controls="rep-moved-grid" onClick={() => setMoved(o => !o)}>
              What moved since {report.compare.long}
            </button>
          </h2>
          <div className="panel rep-moved-grid" id="rep-moved-grid">
            {report.more.length > 0 && <Moves title={`More than ${report.compare.long}`} moves={report.more} />}
            {report.less.length > 0 && <Moves title={`Less than ${report.compare.long}`} moves={report.less} />}
          </div>
        </section>
      )}

      {report.whole && (
        <section className="section">
          <h2>The whole month</h2>
          <dl className="panel whole">
            <div>
              <dt className="lab">Income</dt>
              <dd>
                {formatCents(report.whole.income)}
                {report.whole.incomeLines.map(i => <small key={i.name}>{i.name} · {formatCents(i.cents)}</small>)}
              </dd>
            </div>
            <div>
              <dt className="lab">Spent</dt>
              <dd>
                {formatCents(report.whole.spent)}
                {report.whole.income > 0 && <small>{Math.round((report.whole.spent / report.whole.income) * 100)}% of income</small>}
              </dd>
            </div>
            <div><dt className="lab">Saved</dt><dd>{formatCents(report.whole.saved)}</dd></div>
            <div><dt className="lab">Net</dt><dd>{formatCents(report.whole.net)}</dd></div>
          </dl>
        </section>
      )}

      <p className="rep-foot">{footerText(report, new Date())}</p>
    </article>
  )
}

function Actions({ report, rows }: { report: Report; rows: readonly CsvTransaction[] | undefined }) {
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(reportText(report, new Date()))
      setCopy('done')
    } catch {
      setCopy('failed')
    }
    window.setTimeout(() => setCopy('idle'), 2500)
  }

  return (
    <div className="page-actions rep-actions">
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        <Printer size={15} aria-hidden="true" />Print / PDF
      </button>
      <button type="button" className="btn" onClick={copyText}>
        {copy === 'done' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {copy === 'done' ? 'Copied' : copy === 'failed' ? "Couldn't copy" : 'Copy text'}
      </button>
      <button type="button" className="btn" disabled={!rows} onClick={() => rows && downloadCsv(rows, csvFilename(`transactions-${report.month}`))}>
        <Download size={15} aria-hidden="true" />CSV file
      </button>
      <span className="rep-live" role="status">{copy === 'done' ? 'Copied to the clipboard' : ''}</span>
    </div>
  )
}

function Group({ group, since }: { group: ReportGroup; since: string | null }) {
  const [open, setOpen] = useState(false)
  const quiet = group.rows.filter(isQuiet)
  const fold = quiet.length > 1
  const row = (r: ReportGroup['rows'][number], hidden: boolean) => (
    <li className={`rep-row${hidden ? ' is-quiet' : ''}`} key={r.id}>
      <span className="rep-name">{r.name}</span>
      <span className="rep-spent num">{spentText(r)}</span>
      <span className="rep-plan num">{planText(r)}</span>
      <span className="rep-delta num">{since ? sinceText(r, since) : ''}</span>
    </li>
  )
  const live = fold ? group.rows.filter(r => !isQuiet(r)) : group.rows
  return (
    <section className="panel rep-group" aria-label={group.label}>
      <h3 className="rep-ghead">
        <span>{group.label}</span>
        <span className="rep-gtotal num">{formatEuros(group.spent)} of {formatEuros(group.plan)}</span>
      </h3>
      <div className="rep-cols lab" aria-hidden="true">
        <span>Category</span><span>Spent</span><span>Plan</span><span>{since ? `Since ${since}` : ''}</span>
      </div>
      <ul>
        {live.map(r => row(r, false))}
      </ul>
      {fold && (
        <>
          <button type="button" className="rep-quiet" aria-expanded={open} aria-controls={`rep-quiet-${group.kind}`} onClick={() => setOpen(o => !o)}>
            <span>Nothing spent in {quiet.length} categories</span>
            <span className="num">{formatEuros(quiet.reduce((a, r) => a + r.plan, 0))} planned</span>
          </button>
          <ul id={`rep-quiet-${group.kind}`} className={`rep-quiet-list${open ? ' is-open' : ''}`}>
            {quiet.map(r => row(r, true))}
          </ul>
        </>
      )}
    </section>
  )
}

function Moves({ title, moves }: { title: string; moves: Report['more'] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {moves.map(m => (
          <li className="rep-row rep-mrow" key={m.name}>
            <span className="rep-name">{m.name}</span>
            <span className="rep-spent num">{moveText(m)}</span>
            <span className="rep-plan num">{moveRange(m)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
