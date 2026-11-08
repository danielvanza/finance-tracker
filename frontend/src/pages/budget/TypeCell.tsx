import { useState, useRef, useEffect } from 'react'
import { api } from '../../api'
import { describeApiError } from '../../components/ErrorBanner'

// ── Category type pill + inline dropdown ─────────────────────────────────────
export const TYPE_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  needs:   { label: 'Needs',   color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.22)'  },
  wants:   { label: 'Wants',   color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.22)' },
  savings: { label: 'Savings', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.22)'   },
}
export const TYPE_OPTIONS = ['needs', 'wants', 'savings'] as const

interface TypeCellProps {
  categoryId: number
  type: string
  onSaved: () => void
  onError?: (message: string) => void
}

export function TypeCell({ categoryId, type, onSaved, onError }: TypeCellProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cfg = TYPE_CFG[type]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = async (newType: string) => {
    setOpen(false)
    if (newType === type) return
    try {
      await api.patchCategory(categoryId, { type: newType })
      onSaved()
    } catch (e) {
      if (onError) {
        onError(describeApiError(e))
      } else {
        console.error('Failed to change category type:', e)
      }
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Click to change type"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: cfg?.color ?? 'var(--text-muted)',
          background: cfg?.bg ?? 'transparent',
          border: `1px solid ${cfg?.border ?? 'var(--border)'}`,
          borderRadius: 'var(--radius-full)',
          padding: '2px 8px 2px 7px',
          lineHeight: '16px',
          cursor: 'pointer',
          transition: 'filter 0.15s ease, box-shadow 0.15s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.2)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${cfg?.border ?? 'transparent'}` }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}
      >
        {cfg?.label ?? type}
        {/* chevron */}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginTop: 1 }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 'var(--z-overlay)' as any,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          minWidth: 100,
          animation: 'categoryDropIn 0.12s var(--ease-out) both',
        }}>
          {TYPE_OPTIONS.map(opt => {
            const c = TYPE_CFG[opt]
            const active = opt === type
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 12px',
                  background: active ? 'rgba(148,163,184,0.06)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: c.color, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(148,163,184,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'rgba(148,163,184,0.06)' : 'transparent' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                {c.label}
                {active && (
                  <svg style={{ marginLeft: 'auto' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
