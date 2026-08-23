import { formatCents } from '../../money'
import type { Transaction } from '../../types'
import { getSourceStyle } from './sourceStyles'

interface TransactionsTableProps {
  transactions: Transaction[]
  setSplitTx: (tx: Transaction) => void
  handleDelete: (tx: Transaction) => void
}

export default function TransactionsTable({ transactions, setSplitTx, handleDelete }: TransactionsTableProps) {
  return (
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
                color: tx.amount_cents < 0 ? 'var(--red)' : 'var(--green)',
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
                {tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
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
                        {s.is_refund && (
                          <span title="Refund part — nets against its category" style={{marginRight:4,
                            fontSize:9,fontWeight:700,color:'var(--cyan)',background:'var(--cyan-bg)',
                            border:'1px solid var(--cyan-border)',padding:'0 5px',borderRadius:'var(--radius-xs)',
                            textTransform:'uppercase',letterSpacing:'0.06em'}}>R</span>
                        )}
                        {s.category_name ?? '—'} <span style={{
                          fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums',
                          opacity: 0.8,
                        }}>{formatCents(Math.abs(s.amount_cents))}</span>
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
  )
}
