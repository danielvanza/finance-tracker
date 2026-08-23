// Source color map
export const SOURCE_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  ing:     { color: 'var(--orange)',       bg: 'var(--orange-bg)',  border: 'var(--orange-border)' },
  revolut: { color: 'var(--violet)',       bg: 'var(--violet-bg)', border: 'var(--violet-border)' },
  degiro:  { color: 'var(--cyan)',         bg: 'var(--cyan-bg)',   border: 'var(--cyan-border)' },
  manual:  { color: 'var(--green)',        bg: 'var(--green-bg)',  border: 'var(--green-border)' },
}

export const getSourceStyle = (source: string) =>
  SOURCE_STYLES[source.toLowerCase()] ?? { color: 'var(--text-label)', bg: 'rgba(148,163,184,0.07)', border: 'var(--border-strong)' }

export const SOURCE_FILTERS = ['all', 'ing', 'revolut', 'degiro', 'manual']
