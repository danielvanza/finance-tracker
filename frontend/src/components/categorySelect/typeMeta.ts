/* ── Colour mapping per category type ── */
export const TYPE_META: Record<string, { label: string; color: string; bg: string; border: string; glow: string }> = {
  needs:   { label: 'Needs',   color: 'var(--green)',  bg: 'var(--green-bg)',  border: 'var(--green-border)',  glow: 'var(--green-glow)' },
  wants:   { label: 'Wants',   color: 'var(--violet)', bg: 'var(--violet-bg)', border: 'var(--violet-border)', glow: 'rgba(167,139,250,0.28)' },
  savings: { label: 'Savings', color: 'var(--cyan)',   bg: 'var(--cyan-bg)',   border: 'var(--cyan-border)',   glow: 'rgba(34,211,238,0.28)' },
  income:  { label: 'Income',  color: 'var(--yellow)', bg: 'var(--yellow-bg)', border: 'var(--yellow-border)', glow: 'var(--yellow-glow)' },
  exclude: { label: 'Exclude', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', glow: 'rgba(148,163,184,0.15)' },
}

export const GROUP_ORDER = ['needs', 'wants', 'savings', 'income', 'exclude']
