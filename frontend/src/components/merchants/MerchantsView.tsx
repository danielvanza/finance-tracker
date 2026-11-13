import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { api } from '../../api'
import { dayLabel } from '../../dates'
import { formatEuros } from '../../money'
import ErrorBanner, { describeApiError } from '../ErrorBanner'
import { DEFAULT_START_DAY, monthName, rankMerchants, scopeRange } from './merchantData'
import type { MerchantScope, MerchantView } from './types'
import { useMerchantSheet } from './useMerchantSheet'
import ViewSwitch from './ViewSwitch'
import '../../styles/merchants.css'

const FIRST = 8
const STEP = 20
const SCOPES: Array<{ id: MerchantScope; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'six', label: '6 months' },
  { id: 'all', label: 'All time' },
]

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Where the money went: merchants ranked by spend in needs and wants, for this financial month,
 * the last six, or all time. Replaces the transactions list while "Merchants" is chosen; it draws
 * its own view switch so both sit in one row. Rows open the merchant sheet (needs a
 * MerchantSheetProvider above).
 */
export default function MerchantsView({ onView }: { onView: (view: MerchantView) => void }) {
  const { open } = useMerchantSheet()
  const viewsRef = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState<MerchantScope>('month')
  const [shown, setShown] = useState(FIRST)
  const transactions = useQuery({ queryKey: ['transactions', 'all'], queryFn: () => api.getTransactions() })
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const pace = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })

  const failed = [transactions, categories, pace, settings].find(q => q.error)
  const ready = transactions.data && categories.data && pace.data && settings.data
  const loaded = Boolean(ready)

  // On a phone the review card can fill the screen above the switch: once the list is drawn (so the
  // page is as tall as it will be), bring the switch to the top, as far as the page allows.
  useEffect(() => {
    if (!loaded || !window.matchMedia?.('(max-width: 719px)').matches) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewsRef.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [loaded])
  const startDay = Number(settings.data?.financial_month_start_day)
    || Number(pace.data?.start_date.slice(8)) || DEFAULT_START_DAY

  const range = ready ? scopeRange(scope, pace.data!.current_month, startDay) : null
  const ranked = ready ? rankMerchants(transactions.data!, categories.data!, range) : []
  const biggest = ranked[0]?.cents ?? 1
  const status = pace.data?.status

  const scopeLabel = !ready ? '' : `${
    range ? `${dayLabel(range.from)} – ${dayLabel(range.to)}` : 'Every date'
  } · ${plural(ranked.length, 'merchant')}`

  const emptyText = () => {
    if (status === 'empty') return 'No bank files yet. Bring in a file to see where the money goes.'
    if (scope === 'month') return `Nothing spent in ${monthName(pace.data!.current_month)} yet.`
    return 'Nothing spent in this period.'
  }

  return (
    <>
      <div className="mer-views" ref={viewsRef}>
        <ViewSwitch value="merchants" onChange={onView} />
        <div className="seg" role="group" aria-label="Period">
          {SCOPES.map(s => (
            <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => { setScope(s.id); setShown(FIRST) }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <ErrorBanner title="Merchants didn't load" message={describeApiError(failed.error)} />
      ) : !ready ? (
        <div className="panel" aria-busy="true" aria-label="Loading merchants">
          {[0, 1, 2, 3].map(i => <span key={i} className="skeleton mer-skel-row" />)}
        </div>
      ) : (
        <>
          <p className="lab mer-scope">{scopeLabel}</p>
          {status === 'gap' && scope !== 'all' && (
            <p className="tx-hint mer-scope">This month's bank files haven't been imported yet, so this shows what is recorded.</p>
          )}
          <section className="panel cat-group" aria-label="Top merchants">
            {ranked.length === 0 ? (
              <p className="empty">
                {emptyText()}
                {status === 'empty' && <> <Link to="/import">Import a bank file</Link></>}
              </p>
            ) : (
              <ul>
                {ranked.slice(0, shown).map(m => (
                  <li className="cat" key={m.key}>
                    <button type="button" className="cat-row mer-row" onClick={() => open(m.sample)}>
                      <span className="cat-name">{m.name}</span>
                      <span className="cat-amount num">
                        {formatEuros(m.cents)}<small> · {plural(m.purchases, 'purchase')}</small>
                        <ChevronRight className="mer-go" size={14} aria-hidden="true" />
                      </span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${Math.max(3, Math.round((m.cents / biggest) * 100))}%` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ranked.length > shown && (
              <button type="button" className="btn btn-wide tx-more" onClick={() => setShown(n => n + STEP)}>
                Show {Math.min(STEP, ranked.length - shown)} more of {ranked.length - shown}
              </button>
            )}
          </section>
        </>
      )}
    </>
  )
}
