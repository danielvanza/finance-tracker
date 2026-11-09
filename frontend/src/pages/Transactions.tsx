import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '../api'
import { formatCents } from '../money'
import type { Transaction } from '../types'
import ReviewCard, { type ReviewDecision } from '../components/ReviewCard'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import AddTransactionModal from '../components/AddTransactionModal'
import SplitModal from '../components/SplitModal'
import TransactionsToolbar from './transactions/TransactionsToolbar'
import TransactionsTable from './transactions/TransactionsTable'

export default function Transactions() {
  const qc = useQueryClient()
  const [showReview, setShowReview] = useState(true)
  const [skippedIds, setSkippedIds] = useState<number[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [actionError, setActionError] = useState('')

  const { data: transactions = [], isLoading: listLoading, error: listError } = useQuery({
    queryKey: ['transactions', sourceFilter],
    queryFn: () => api.getTransactions(sourceFilter === 'all' ? {} : { source: sourceFilter }),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
  const { data: reviewTx, isLoading: reviewLoading, error: reviewError } = useQuery({
    queryKey: ['review', skippedIds],
    queryFn: () => api.getNextReview(skippedIds),
    enabled: showReview,
  })

  const unconfirmedCount = transactions.filter(t => !t.confirmed).length

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

  const handleCreateRule = async (id: number, categoryId: number) => {
    setActionError('')
    try {
      await api.patchTransaction(id, { category_id: categoryId })
      await api.createRuleFromTransaction(id)
    } catch (e) {
      setActionError(describeApiError(e))
      return
    }
    setSkippedIds([])
    invalidate()
    qc.invalidateQueries({ queryKey: ['rules'] })
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

  const reviewSkeleton = showReview && reviewLoading && unconfirmedCount > 0
  const onlySkippedLeft = showReview && !reviewTx && !reviewLoading && !reviewError && skippedIds.length > 0
  const reviewVisible = (showReview && !!reviewTx) || reviewSkeleton || onlySkippedLeft

  return (
    <div className="tx-page">
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          {!listLoading && !listError && (
            <p className="num">
              {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
              {unconfirmedCount > 0 && ` · ${unconfirmedCount} to review`}
            </p>
          )}
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setShowAdd(true)}>
            <Plus size={15} aria-hidden="true" />
            Add transaction
          </button>
          {unconfirmedCount > 0 && (
            <button
              type="button"
              className={showReview ? 'btn' : 'btn btn-primary'}
              onClick={() => setShowReview(!showReview)}
            >
              {showReview ? 'Close review' : <><span className="num">{unconfirmedCount}</span> Review pending</>}
            </button>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />}
      {showReview && reviewError && <ErrorBanner message={describeApiError(reviewError)} />}

      <div className={`tx-layout${reviewVisible ? ' has-review' : ''}`}>
        {reviewVisible && (
          <section className="tx-review" aria-label="Review queue">
            {reviewSkeleton && <span className="skeleton tx-skel-review" aria-busy="true" aria-label="Loading the next transaction" />}

            {showReview && reviewTx && (
              <>
                <div className="tx-review-head">
                  <h2>To review</h2>
                  <span className="lab num">
                    {unconfirmedCount} remaining{skippedIds.length > 0 && ` · ${skippedIds.length} skipped`}
                  </span>
                </div>
                <ReviewCard
                  key={reviewTx.id}
                  transaction={reviewTx}
                  categories={categories}
                  onConfirm={handleConfirm}
                  onSkip={() => handleSkip(reviewTx.id)}
                  onCreateRule={handleCreateRule}
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
          <TransactionsToolbar sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} />
          {listError ? (
            <ErrorBanner title="Transactions didn't load" message={describeApiError(listError)} />
          ) : listLoading ? (
            <div className="panel tx-panel" aria-busy="true" aria-label="Loading transactions">
              {[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton tx-skel-row" />)}
            </div>
          ) : (
            <TransactionsTable
              transactions={transactions}
              setSplitTx={setSplitTx}
              handleDelete={handleDelete}
              filtered={sourceFilter !== 'all'}
            />
          )}
        </section>
      </div>

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
  )
}
