import { useState } from 'react'
import type { Transaction, Category } from '../types'

interface Props {
  transaction: Transaction
  categories: Category[]
  onConfirm: (id: number, categoryId: number) => void
  onSkip: () => void
  onCreateRule: (id: number, categoryId: number) => void
}

export default function ReviewCard({ transaction: tx, categories, onConfirm, onSkip, onCreateRule }: Props) {
  const filteredCategories = categories.filter(c => tx.amount > 0 ? c.type === 'income' : c.type !== 'income')
  const [selectedCategory, setSelectedCategory] = useState<number>(tx.category_id ?? filteredCategories[0]?.id)
  const [confirmHover, setConfirmHover] = useState(false)
  const [skipHover, setSkipHover] = useState(false)
  const [ruleHover, setRuleHover] = useState(false)

  const isExpense = tx.amount < 0
  const amountColor = isExpense ? 'var(--red)' : 'var(--green)'
  const amountGlow = isExpense ? 'rgba(248,113,113,0.3)' : 'rgba(34,197,94,0.3)'

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-lg)',
      maxWidth: 520,
      boxShadow: '0 8px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
      overflow: 'hidden',
    }}>
      {/* Orange accent bar at top */}
      <div style={{
        height: 3,
        background: 'linear-gradient(90deg, var(--orange), var(--yellow))',
        opacity: 0.85,
      }} />

      <div style={{ padding: '20px 22px 22px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
            <div style={{
              fontSize: 15, fontWeight: 600, color: 'var(--text-h)', marginBottom: 6,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {tx.description}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tx.date}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-label)',
                background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                padding: '2px 7px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase',
                letterSpacing: '0.08em', fontFamily: 'var(--mono)',
              }}>{tx.source}</span>
            </div>
          </div>
          <div style={{
            fontSize: 22, fontWeight: 800,
            color: amountColor,
            letterSpacing: '-0.04em',
            textShadow: `0 0 16px ${amountGlow}`,
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {isExpense ? '-' : '+'}€{Math.abs(tx.amount).toFixed(2)}
          </div>
        </div>

        {/* AI suggestion banner */}
        {tx.categorised_by === 'ai' && tx.category_name && (
          <div style={{
            marginBottom: 16, padding: '10px 14px',
            background: 'rgba(251, 191, 36, 0.06)',
            border: '1px solid rgba(251, 191, 36, 0.18)',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {/* Sparkle icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>AI suggests:</span>
            <span style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 600 }}>{tx.category_name}</span>
            {tx.ai_confidence && (
              <span style={{
                marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11,
                background: 'var(--bg-input)', padding: '2px 7px',
                borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)',
                fontFamily: 'var(--mono)', fontWeight: 500,
              }}>
                {Math.round(tx.ai_confidence * 100)}%
              </span>
            )}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

        {/* Category selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={{
            display: 'block', marginBottom: 7,
            fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Category
          </label>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(Number(e.target.value))}
            style={{
              width: '100%',
              background: 'var(--bg-input)', color: 'var(--text-h)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              padding: '9px 32px 9px 12px',
              fontSize: 13.5, fontFamily: 'var(--sans)',
              cursor: 'pointer',
            }}
          >
            {filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Primary actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            onClick={() => onConfirm(tx.id, selectedCategory)}
            onMouseEnter={() => setConfirmHover(true)}
            onMouseLeave={() => setConfirmHover(false)}
            style={{
              flex: 1,
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius)',
              padding: '10px 16px',
              cursor: 'pointer', fontWeight: 600, fontSize: 13.5,
              fontFamily: 'var(--sans)',
              boxShadow: confirmHover
                ? '0 6px 20px rgba(99,102,241,0.5)'
                : '0 3px 12px rgba(99,102,241,0.3)',
              transform: confirmHover ? 'translateY(-1px)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
              letterSpacing: '-0.01em',
            }}
          >
            Confirm Category
          </button>
          <button
            onClick={onSkip}
            onMouseEnter={() => setSkipHover(true)}
            onMouseLeave={() => setSkipHover(false)}
            style={{
              background: skipHover ? 'rgba(148,163,184,0.08)' : 'transparent',
              color: skipHover ? 'var(--text-h)' : 'var(--text-secondary)',
              border: `1px solid ${skipHover ? 'var(--border-strong)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)', padding: '10px 16px',
              cursor: 'pointer', fontSize: 13.5, fontFamily: 'var(--sans)',
              transition: 'all 0.15s ease',
              letterSpacing: '-0.01em',
            }}
          >
            Skip
          </button>
        </div>

        {/* Rule creation */}
        <button
          onClick={() => onCreateRule(tx.id, selectedCategory)}
          onMouseEnter={() => setRuleHover(true)}
          onMouseLeave={() => setRuleHover(false)}
          style={{
            width: '100%',
            background: ruleHover ? 'var(--accent-bg)' : 'transparent',
            color: ruleHover ? 'var(--accent-light)' : 'var(--text-secondary)',
            border: `1px solid ${ruleHover ? 'var(--accent-border)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', padding: '8px 12px',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
            transition: 'all 0.15s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          Always categorise "{tx.description}" as this
        </button>
      </div>
    </div>
  )
}
