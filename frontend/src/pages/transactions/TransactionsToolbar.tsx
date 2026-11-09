import { SOURCE_FILTERS } from './sources'

interface TransactionsToolbarProps {
  sourceFilter: string
  setSourceFilter: (s: string) => void
}

export default function TransactionsToolbar({ sourceFilter, setSourceFilter }: TransactionsToolbarProps) {
  return (
    <div className="seg tx-filter">
      {SOURCE_FILTERS.map(s => (
        <button key={s} type="button" aria-pressed={sourceFilter === s} onClick={() => setSourceFilter(s)}>
          {s === 'all' ? 'All sources' : s}
        </button>
      ))}
    </div>
  )
}
