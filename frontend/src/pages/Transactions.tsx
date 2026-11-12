import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '../api'
import { formatCents } from '../money'
import type { Transaction } from '../types'
import ReviewCard, { type ReviewDecision } from '../components/ReviewCard'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import AddTransactionModal from '../components/AddTransactionModal'
import SplitModal from '../components/SplitModal'
import ImportLink from '../components/ImportLink'
import CsvChip from '../components/reports/CsvChip'
import {
  MerchantSheetProvider, MerchantsView, ViewSwitch, type MerchantView,
} from '../components/merchants'
import TransactionsToolbar from './transactions/TransactionsToolbar'
import TransactionsTable from './transactions/TransactionsTable'
import SelectionBar from './transactions/SelectionBar'
import { filterTransactions, hasFilters, type ListFilters, type MonthRange } from './transactions/filters'
import { categoriseRows, confirmRows, deleteRows, describeOutcome, type BulkOutcome } from './transactions/bulk'
import type { Category } from '../types'

export default function Transactions() {
  const qc = useQueryClient()
  const [showReview, setShowReview] = useState(true)
  const [skippedIds, setSkippedIds] = useState<number[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [actionError, setActionError] = useState('')
  const [view, setView] = useState<MerchantView>('transactions')

  // The search lives in the URL (?q=): Back returns to it, and a link or the command palette can open it.
  // The box keeps its own text so typing never waits on the router; the URL follows it, and a URL
  // we didn't write (another search link while on this page) replaces it.
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const [q, setQLocal] = useState(urlQ)
  const written = useRef(new Set<string>())
  useEffect(() => {
    if (urlQ === q) written.current.clear()
    else if (!written.current.has(urlQ)) setQLocal(urlQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ])
  const setQ = (value: string) => {
    setQLocal(value)
    written.current.add(value)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set('q', value)
      else next.delete('q')
      return next
    }, { replace: true })
  }
  const [chips, setChips] = useState({ needsReview: false, thisMonth: false, categoryId: null as number | null, source: 'all', over100: false })
  const filters: ListFilters = { q, ...chips }

  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [bulkError, setBulkError] = useState<{ title: string; message: string } | null>(null)
  // After a person corrects a payment the app sorted by itself: offer to always ask about its shop.
  const [offer, setOffer] = useState<{ tx: Transaction; category: string; asked?: string } | null>(null)

  const { data: transactions = [], isLoading: listLoading, error: listError } = useQuery({
    queryKey: ['transactions', 'list'],
    queryFn: () => api.getTransactions(),
  })
  // The review queue is its own count: filtering or loading the list must not change it.
  const { data: waiting } = useQuery({
    queryKey: ['transactions', 'to-review'],
    queryFn: () => api.getTransactions({ confirmed: 'false' }),
  })
  const reviewCount = waiting ? waiting.length : null
  // "This month" is the financial month the pace endpoint names, never the calendar.
  const { data: pace } = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const month: MonthRange | null = pace && pace.month === pace.current_month ? { start: pace.start_date, end: pace.end_date } : null
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
  const { data: reviewTx, isLoading: reviewLoading, error: reviewError } = useQuery({
    queryKey: ['review', skippedIds],
    queryFn: () => api.getNextReview(skippedIds),
    enabled: showReview,
  })

  const visible = useMemo(() => filterTransactions(transactions, filters, month), [transactions, q, chips, month]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickedRows = useMemo(() => visible.filter(t => picked.has(t.id)), [visible, picked])
  const narrowed = hasFilters(filters)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['review'] })
  }

  const handleConfirm = async (id: number, decision: ReviewDecision) => {
    setActionError('')
    try {
      await api.patchTransaction(id, { ...decision, confirmed: true })
    } catch (e) {
      setActionError(describeApiError(e))
      return
    }
    setSkippedIds(prev => prev.filter(sid => sid !== id))
    invalidate()
  }

  const handleSkip = (id: number) => {
    setSkippedIds(prev => [...prev, id])
  }

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm(`Delete manual transaction "${tx.description}" (${tx.amount_cents < 0 ? '-' : '+'}${formatCents(Math.abs(tx.amount_cents))})?`)) return
    setActionError('')
    try {
      await api.deleteTransaction(tx.id)
      invalidate()
    } catch (e) {
      setActionError(describeApiError(e))
    }
  }

  const clearFilters = () => {
    setQ('')
    setChips({ needsReview: false, thisMonth: false, categoryId: null, source: 'all', over100: false })
  }

  const togglePick = (id: number) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const leaveSelecting = () => {
    setSelecting(false)
    setPicked(new Set())
    setBulkError(null)
  }

  // No bulk endpoint: one PATCH per row, and the rows that failed stay ticked.
  const runBulk = async (rows: typeof pickedRows, job: () => Promise<BulkOutcome>) => {
    setBusy(true)
    setBulkError(null)
    setActionError('')
    const outcome = await job()
    setBusy(false)
    setPicked(prev => {
      const next = new Set(prev)
      outcome.done.forEach(id => next.delete(id))
      return next
    })
    setBulkError(describeOutcome(rows.length, outcome))
    invalidate()
  }

  const bulkConfirm = () => {
    const rows = pickedRows.filter(t => !t.confirmed)
    return runBulk(rows, () => confirmRows(rows))
  }
  const bulkCategory = (id: number) => {
    const category = categories.find((c: Category) => c.id === id)
    if (!category) return
    return runBulk(pickedRows, () => categoriseRows(pickedRows, category))
  }
  const changeCategory = async (tx: Transaction, id: number) => {
    const category = categories.find((c: Category) => c.id === id)
    if (!category) return
    setActionError('')
    const outcome = await categoriseRows([tx], category)
    invalidate()
    if (outcome.left.length > 0) {
      setActionError(`${tx.description} didn't change. Try again.`)
      return
    }
    const sortedByItself = tx.categorised_by === 'ai' || tx.categorised_by === 'rule'
    setOffer(sortedByItself ? { tx, category: category.name } : null)
  }
  const alwaysAsk = async () => {
    if (!offer) return
    setActionError('')
    try {
      const { removed_rules } = await api.alwaysAsk(offer.tx.id)
      const rule = removed_rules.length > 0 ? ` The rule “${removed_rules.join('”, “')}” is gone.` : ''
      setOffer({ ...offer, asked: `From now on you'll be asked about each payment there.${rule} Undo it on the Rules page.` })
      qc.invalidateQueries({ queryKey: ['ask-shops'] })
      qc.invalidateQueries({ queryKey: ['rules'] })
    } catch (e) {
      setActionError(describeApiError(e))
    }
  }

  const bulkDelete = () => {
    const n = pickedRows.length
    if (!window.confirm(`Delete ${n} manual transaction${n === 1 ? '' : 's'}?`)) return
    return runBulk(pickedRows, () => deleteRows(pickedRows))
  }

  const reviewSkeleton = showReview && reviewLoading && reviewCount !== 0
  const onlySkippedLeft = showReview && !reviewTx && !reviewLoading && !reviewError && skippedIds.length > 0
  const reviewVisible = (showReview && !!reviewTx) || reviewSkeleton || onlySkippedLeft

  return (
    <MerchantSheetProvider>
    <div className="tx-page">
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p className="num">
            {reviewCount == null ? '\u00a0' : reviewCount > 0 ? `${reviewCount} to review` : 'Nothing to review'}
          </p>
        </div>
        <div className="page-actions">
          <ImportLink />
          <button type="button" className="btn" onClick={() => setShowAdd(true)}>
            <Plus size={15} aria-hidden="true" />
            Add transaction
          </button>
          <button type="button" className="btn" onClick={() => (selecting ? leaveSelecting() : setSelecting(true))}>
            {selecting ? 'Done' : 'Select'}
          </button>
          {reviewCount != null && reviewCount > 0 && (
            <button
              type="button"
              className={showReview ? 'btn' : 'btn btn-primary'}
              onClick={() => setShowReview(!showReview)}
            >
              {showReview ? 'Close review' : <><span className="num">{reviewCount}</span> Review pending</>}
            </button>
          )}
          <CsvChip rows={visible} />
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />}
      {bulkError && <ErrorBanner title={bulkError.title} message={bulkError.message} onDismiss={() => setBulkError(null)} />}
      {showReview && reviewError && <ErrorBanner message={describeApiError(reviewError)} />}
      {offer && (
        <div className="panel tx-offer" role="status">
          {offer.asked ? (
            <p><strong>{offer.tx.description}</strong> is always asked about. {offer.asked}</p>
          ) : (
            <>
              <p>
                Moved to {offer.category}. Does <strong>{offer.tx.description}</strong> sell a bit of everything?
                Then the app asks about each payment there instead of guessing.
              </p>
              <button type="button" className="btn btn-sm" onClick={alwaysAsk}>Always ask about this shop</button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setOffer(null)}>{offer.asked ? 'OK' : 'No, just this one'}</button>
        </div>
      )}

      <div className={`tx-layout${reviewVisible ? ' has-review' : ''}`}>
        {reviewVisible && (
          <section className="tx-review" aria-label="Review queue">
            {reviewSkeleton && <span className="skeleton tx-skel-review" aria-busy="true" aria-label="Loading the next transaction" />}

            {showReview && reviewTx && (
              <>
                <div className="tx-review-head">
                  <h2>To review</h2>
                  <span className="lab num">
                    {[reviewCount != null && `${reviewCount} remaining`, skippedIds.length > 0 && `${skippedIds.length} skipped`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <ReviewCard
                  key={reviewTx.id}
                  transaction={reviewTx}
                  categories={categories}
                  onConfirm={handleConfirm}
                  onSkip={() => handleSkip(reviewTx.id)}
                />
              </>
            )}

            {/* All non-skipped reviewed, but skipped items remain */}
            {onlySkippedLeft && (
              <div className="panel tx-skipped">
                <p>{skippedIds.length} transaction{skippedIds.length > 1 ? 's' : ''} skipped. Review {skippedIds.length > 1 ? 'them' : 'it'} now?</p>
                <button type="button" className="btn btn-primary" onClick={() => setSkippedIds([])}>Review skipped</button>
              </div>
            )}
          </section>
        )}

        <section className="tx-list" aria-label="All transactions">
          {view === 'merchants' ? (
            <MerchantsView onView={setView} />
          ) : (
            <>
              <div className="mer-views"><ViewSwitch value="transactions" onChange={setView} /></div>
              <TransactionsToolbar
                filters={filters}
                categories={categories}
                reviewCount={reviewCount}
                monthKnown={month != null}
                shown={visible.length}
                total={transactions.length}
                counted={!listLoading && !listError}
                active={narrowed}
                onSearch={setQ}
                onChange={patch => setChips(c => ({ ...c, ...patch }))}
                onClear={clearFilters}
              />
              {listError ? (
                <ErrorBanner title="Transactions didn't load" message={describeApiError(listError)} />
              ) : listLoading ? (
                <div className="panel tx-panel" aria-busy="true" aria-label="Loading transactions">
                  {[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton tx-skel-row" />)}
                </div>
              ) : (
                <TransactionsTable
                  transactions={visible}
                  categories={categories}
                  onCategory={changeCategory}
                  setSplitTx={setSplitTx}
                  handleDelete={handleDelete}
                  filtered={narrowed}
                  selecting={selecting}
                  picked={picked}
                  onPick={togglePick}
                  onClear={clearFilters}
                />
              )}
            </>
          )}
        </section>
      </div>

      {selecting && pickedRows.length > 0 && (
        <SelectionBar
          rows={pickedRows}
          categories={categories}
          busy={busy}
          onConfirm={bulkConfirm}
          onCategory={bulkCategory}
          onDelete={bulkDelete}
          onClear={() => { setPicked(new Set()); setBulkError(null) }}
        />
      )}

      {showAdd && (
        <AddTransactionModal
          categories={categories}
          onClose={() => setShowAdd(false)}
          onSaved={invalidate}
        />
      )}
      {splitTx && (
        <SplitModal
          transaction={splitTx}
          categories={categories}
          onClose={() => setSplitTx(null)}
          onSaved={invalidate}
        />
      )}
    </div>
    </MerchantSheetProvider>
  )
}
