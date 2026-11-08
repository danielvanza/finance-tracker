import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  const [showReview, setShowReview] = useState(false)
  const [skippedIds, setSkippedIds] = useState<number[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [actionError, setActionError] = useState('')

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', sourceFilter],
    queryFn: () => api.getTransactions(sourceFilter === 'all' ? {} : { source: sourceFilter }),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
  const { data: reviewTx } = useQuery({
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

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Transactions</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {transactions.length} transactions
            {unconfirmedCount > 0 && (
              <span style={{ marginLeft: 10, color: 'var(--orange)', fontWeight: 500 }}>
                · {unconfirmedCount} pending review
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              background: 'transparent',
              color: 'var(--accent-light)',
              border: '1px solid var(--accent-border)',
              borderRadius: 'var(--radius)', padding: '9px 16px',
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
              fontFamily: 'var(--sans)',
              display: 'flex', alignItems: 'center', gap: 7,
              letterSpacing: '-0.01em',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Transaction
          </button>
          {unconfirmedCount > 0 && (
            <button
              onClick={() => setShowReview(!showReview)}
              style={{
                background: showReview
                  ? 'var(--orange-bg)'
                  : 'linear-gradient(135deg, #c2410c, #ea580c)',
                color: showReview ? 'var(--orange)' : '#fff',
                border: showReview ? '1px solid var(--orange-border)' : 'none',
                borderRadius: 'var(--radius)', padding: '9px 16px',
                cursor: 'pointer', fontWeight: 600, fontSize: 13,
                fontFamily: 'var(--sans)',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all 0.2s ease',
                boxShadow: showReview ? 'none' : '0 4px 14px rgba(234,88,12,0.4)',
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{
                background: showReview ? 'var(--orange)' : 'rgba(255,255,255,0.2)',
                color: '#fff',
                borderRadius: 'var(--radius-full)',
                width: 20, height: 20,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
              }}>{unconfirmedCount}</span>
              {showReview ? 'Close Review' : 'Review Pending'}
            </button>
          )}
        </div>
      </div>

      {/* Review panel */}
      {actionError && <ErrorBanner message={actionError} />}
      {showReview && reviewTx && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--orange)',
                boxShadow: '0 0 8px var(--orange)',
                animation: 'pulseGlow 2s ease-in-out infinite',
              }} />
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)' }}>Review Queue</h3>
            </div>
            <span style={{
              fontSize: 11, color: 'var(--orange)', background: 'var(--orange-bg)',
              border: '1px solid var(--orange-border)', borderRadius: 'var(--radius-full)',
              padding: '2px 9px', fontWeight: 700, letterSpacing: '0.02em',
            }}>{unconfirmedCount} remaining{skippedIds.length > 0 && ` · ${skippedIds.length} skipped`}</span>
          </div>
          <ReviewCard
            key={reviewTx.id}
            transaction={reviewTx}
            categories={categories}
            onConfirm={handleConfirm}
            onSkip={() => handleSkip(reviewTx.id)}
            onCreateRule={handleCreateRule}
          />
        </div>
      )}

      {/* All non-skipped reviewed, but skipped items remain */}
      {showReview && !reviewTx && skippedIds.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            textAlign: 'center',
            maxWidth: 520,
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
              You skipped {skippedIds.length} transaction{skippedIds.length > 1 ? 's' : ''}. Ready to review them?
            </p>
            <button
              onClick={() => setSkippedIds([])}
              style={{
                background: 'linear-gradient(135deg, #c2410c, #ea580c)',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius)', padding: '9px 20px',
                cursor: 'pointer', fontWeight: 600, fontSize: 13,
                fontFamily: 'var(--sans)',
                boxShadow: '0 4px 14px rgba(234,88,12,0.4)',
              }}
            >
              Review Skipped
            </button>
          </div>
        </div>
      )}

      {/* Source filter */}
      <TransactionsToolbar sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} />

      {/* Transactions table */}
      <TransactionsTable transactions={transactions} setSplitTx={setSplitTx} handleDelete={handleDelete} />

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

      <style>{`@keyframes pulseGlow { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
    </div>
  )
}
