import { formatCents } from '../money'

interface Props {
  total_income_cents: number
  total_expenses_cents: number
  total_savings_cents: number
  left_over_cents: number
  income_breakdown?: Array<{ category_id: number; category_name: string; amount: number }>
}

interface CardProps {
  label: string
  value: string
  subtext?: string
  gradient: string
  glowColor: string
  borderColor: string
  icon: React.ReactNode
}

import { useState } from 'react'

const Card = ({ label, value, subtext, gradient, glowColor, borderColor, icon }: CardProps) => {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        background: hovered
          ? 'linear-gradient(135deg, rgba(255,255,255,0.035) 0%, var(--bg-card-hover) 100%)'
          : 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px 18px',
        flex: 1,
        border: `1px solid ${hovered ? borderColor : 'var(--border)'}`,
        borderTop: `2px solid transparent`,
        backgroundClip: 'padding-box',
        boxShadow: hovered
          ? `0 8px 40px rgba(0,0,0,0.6), 0 0 24px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.05)`
          : '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
        display: 'flex', flexDirection: 'column', gap: 14,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Gradient top border */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: gradient,
        borderRadius: '16px 16px 0 0',
        opacity: hovered ? 1 : 0.7,
        transition: 'opacity 0.2s ease',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: 'var(--text-label)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          paddingTop: 2,
        }}>
          {label}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: `0 4px 12px ${glowColor}`,
          opacity: hovered ? 1 : 0.85,
          transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        }}>
          {icon}
        </div>
      </div>

      {/* Value */}
      <div>
        <div style={{
          fontSize: 24,
          fontWeight: 800,
          color: 'var(--text-h)',
          letterSpacing: '-0.04em',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </div>
        {subtext && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>{subtext}</div>
        )}
      </div>
    </div>
  )
}

export default function SummaryCards({ total_income_cents, total_expenses_cents, total_savings_cents, left_over_cents, income_breakdown }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
      <Card
        label="Income"
        value={formatCents(total_income_cents)}
        subtext={income_breakdown && income_breakdown.length > 0
          ? income_breakdown.map(b => `${b.category_name}: ${formatCents(b.amount)}`).join(' | ')
          : undefined}
        gradient="linear-gradient(135deg, #22c55e, #16a34a)"
        glowColor="rgba(34, 197, 94, 0.3)"
        borderColor="rgba(34, 197, 94, 0.22)"
        icon={
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
        }
      />
      <Card
        label="Spent"
        value={formatCents(total_expenses_cents)}
        gradient="linear-gradient(135deg, #f87171, #ef4444)"
        glowColor="rgba(248, 113, 113, 0.3)"
        borderColor="rgba(248, 113, 113, 0.22)"
        icon={
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
          </svg>
        }
      />
      <Card
        label="Saved"
        value={formatCents(total_savings_cents)}
        gradient="linear-gradient(135deg, #60a5fa, #3b82f6)"
        glowColor="rgba(96, 165, 250, 0.3)"
        borderColor="rgba(96, 165, 250, 0.22)"
        icon={
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
          </svg>
        }
      />
      <Card
        label="Left Over"
        value={formatCents(left_over_cents)}
        gradient={left_over_cents >= 0 ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'linear-gradient(135deg, #f87171, #ef4444)'}
        glowColor={left_over_cents >= 0 ? 'rgba(251, 191, 36, 0.3)' : 'rgba(248, 113, 113, 0.3)'}
        borderColor={left_over_cents >= 0 ? 'rgba(251, 191, 36, 0.22)' : 'rgba(248, 113, 113, 0.22)'}
        icon={
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        }
      />
    </div>
  )
}
