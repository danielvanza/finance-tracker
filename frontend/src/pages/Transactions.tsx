import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { Transaction } from '../types'
import ReviewCard, { type ReviewDecision } from '../components/ReviewCard'
import AddTransactionModal from '../components/AddTransactionModal'
import SplitModal from '../components/SplitModal'

// Source color map
const SOURCE_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  ing:     { color: 'var(--orange)',       bg: 'var(--orange-bg)',  border: 'var(--orange-border)' },
  revolut: { color: 'var(--violet)',       bg: 'var(--violet-bg)', border: 'var(--violet-border)' },
  degiro:  { color: 'var(--cyan)',         bg: 'var(--cyan-bg)',   border: 'var(--cyan-border)' },
  manual:  { color: 'var(--green)',        bg: 'var(--green-bg)',  border: 'var(--green-border)' },
}

const getSourceStyle = (source: string) =>
  SOURCE_STYLES[source.toLowerCase()] ?? { color: 'var(--text-label)', bg: 'rgba(148,163,184,0.07)', border: 'var(--border-strong)' }

const SOURCE_FILTERS = ['all', 'ing', 'revolut', 'degiro', 'manual']

export default function Transactions() {
  const qc = useQueryClient()
  const [showReview, setShowReview] = useState(false)
  const [skippedIds, setSkippedIds] = useState<number[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [splitTx, setSplitTx] = useState<Transaction | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')

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
    await api.patchTransaction(id, { ...decision, confirmed: true })
    setSkippedIds(prev => prev.filter(sid => sid !== id))
    invalidate()
  }

  const handleCreateRule = async (id: number, categoryId: number) => {
    await api.patchTransaction(id, { category_id: categoryId })
    await api.createRuleFromTransaction(id)
    setSkippedIds([])
    invalidate()
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  const handleSkip = (id: number) => {
    setSkippedIds(prev => [...prev, id])
  }

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm(`Delete manual transaction "${tx.description}" (${tx.amount < 0 ? '-' : '+'}€${Math.abs(tx.amount).toFixed(2)})?`)) return
    await api.deleteTransaction(tx.id)
    invalidate()
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
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {SOURCE_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            style={{
              background: sourceFilter === s ? 'var(--accent-bg)' : 'transparent',
              color: sourceFilter === s ? 'var(--accent-light)' : 'var(--text-secondary)',
              border: `1px solid ${sourceFilter === s ? 'var(--accent-border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-full)', padding: '4px 12px',
              cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
              fontFamily: 'var(--sans)', textTransform: s === 'all' ? 'none' : 'uppercase',
              letterSpacing: s === 'all' ? 0 : '0.05em',
            }}
          >
            {s === 'all' ? 'All sources' : s}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-table-header)', borderBottom: '1px solid var(--border-strong)' }}>
              {['Date', 'Description', 'Amount', 'Category', 'Source', 'AI Conf.', 'Status', ''].map((h, i) => (
                <th key={h || 'actions'} style={{
                  padding: '12px 16px',
                  textAlign: i === 2 ? 'right' : 'left',
                  fontSize: 10.5, fontWeight: 700,
                  color: 'var(--text-label)',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, idx) => (
              <tr
                key={tx.id}
                style={{
                  borderBottom: idx < transactions.length - 1 ? '1px solid var(--border)' : 'none',
                  opacity: tx.confirmed ? 1 : 0.6,
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.04)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{
                  padding: '12px 16px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--mono)', fontSize: 12,
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {tx.date}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--text-h)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tx.description}
                  {tx.standing_adjustment_id != null && (
                    <span
                      title="Created automatically by a standing adjustment"
                      style={{
                        marginLeft: 8, fontSize: 9.5, fontWeight: 700,
                        color: 'var(--cyan)', background: 'var(--cyan-bg)',
                        border: '1px solid var(--cyan-border)',
                        padding: '1px 6px', borderRadius: 'var(--radius-xs)',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}
                    >auto</span>
                  )}
                </td>
                <td style={{
                  padding: '12px 16px', textAlign: 'right',
                  color: tx.amount < 0 ? 'var(--red)' : 'var(--green)',
                  fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12.5,
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {tx.is_refund && (
                    <span
                      title="Refund — reduces the category's spend instead of counting as income"
                      style={{
                        marginRight: 7, fontSize: 9.5, fontWeight: 700,
                        color: 'var(--cyan)', background: 'var(--cyan-bg)',
                        border: '1px solid var(--cyan-border)',
                        padding: '1px 6px', borderRadius: 'var(--radius-xs)',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        fontFamily: 'var(--sans)',
                      }}
                    >refund</span>
                  )}
                  {tx.amount < 0 ? '-' : '+'}€{Math.abs(tx.amount).toFixed(2)}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {tx.splits.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {tx.splits.map(s => (
                        <span key={s.id} style={{
                          background: 'var(--accent-bg)',
                          color: 'var(--accent-light)',
                          border: '1px solid var(--accent-border)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 11, fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}>
                          {s.category_name ?? '—'} <span style={{
                            fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums',
                            opacity: 0.8,
                          }}>€{Math.abs(s.amount).toFixed(2)}</span>
                        </span>
                      ))}
                    </div>
                  ) : tx.category_name ? (
                    <span style={{
                      background: 'var(--accent-bg)',
                      color: 'var(--accent-light)',
                      border: '1px solid var(--accent-border)',
                      padding: '3px 9px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 12, fontWeight: 500,
                    }}>
                      {tx.category_name}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {(() => {
                    const s = getSourceStyle(tx.source)
                    return (
                      <span style={{
                        fontSize: 10.5, fontWeight: 700,
                        color: s.color,
                        background: s.bg,
                        border: `1px solid ${s.border}`,
                        padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        fontFamily: 'var(--mono)',
                      }}>{tx.source}</span>
                    )
                  })()}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {tx.categorised_by === 'ai' && tx.ai_confidence != null ? (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      color: tx.ai_confidence >= 0.8
                        ? 'var(--green)'
                        : tx.ai_confidence >= 0.5
                          ? 'var(--yellow)'
                          : 'var(--red)',
                    }}>
                      {Math.round(tx.ai_confidence * 100)}%
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {tx.confirmed ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 'var(--radius-full)',
                      fontSize: 11.5, fontWeight: 600,
                      background: 'var(--green-bg)', color: 'var(--green)',
                      border: '1px solid var(--green-border)',
                      whiteSpace: 'nowrap',
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {tx.categorised_by ?? 'confirmed'}
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 'var(--radius-full)',
                      fontSize: 11.5, fontWeight: 600,
                      background: 'var(--orange-bg)', color: 'var(--orange)',
                      border: '1px solid var(--orange-border)',
                      whiteSpace: 'nowrap',
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      review
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button
                    onClick={() => setSplitTx(tx)}
                    title={tx.splits.length > 0 ? 'Edit split' : 'Split into multiple categories'}
                    aria-label={`Split transaction ${tx.description}`}
                    style={{
                      background: 'transparent', color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                      cursor: 'pointer', fontSize: 11, fontFamily: 'var(--sans)',
                    }}
                  >
                    {tx.splits.length > 0 ? `Split (${tx.splits.length})` : 'Split'}
                  </button>
                  {tx.source === 'manual' && (
                    <button
                      onClick={() => handleDelete(tx)}
                      title="Delete this manual transaction"
                      aria-label={`Delete transaction ${tx.description}`}
                      style={{
                        marginLeft: 6,
                        background: 'transparent', color: 'var(--red)',
                        border: '1px solid rgba(248,113,113,0.3)',
                        borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                        cursor: 'pointer', fontSize: 11, fontFamily: 'var(--sans)',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '52px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                    </svg>
                    <span style={{ fontSize: 13 }}>No transactions yet. Import a CSV or add one manually.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

      <style>{`@keyframes pulseGlow { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
    </div>
  )
}
