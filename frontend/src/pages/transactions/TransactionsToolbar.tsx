import { SOURCE_FILTERS } from './sourceStyles'

interface TransactionsToolbarProps {
  sourceFilter: string
  setSourceFilter: (s: string) => void
}

export default function TransactionsToolbar({ sourceFilter, setSourceFilter }: TransactionsToolbarProps) {
  return (
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
  )
}
