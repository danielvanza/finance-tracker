import { Search, ChevronDown } from 'lucide-react'
import type { Category } from '../../types'
import CategorySelect from '../../components/CategorySelect'
import ChipMenu from './ChipMenu'
import { SOURCE_FILTERS } from './sources'
import type { ListFilters } from './filters'

interface TransactionsToolbarProps {
  filters: ListFilters
  categories: Category[]
  /** The unconfirmed total, whatever else is filtered; null until it is known. */
  reviewCount: number | null
  /** False while the current financial month isn't known. */
  monthKnown: boolean
  /** Rows showing, rows loaded, and whether the list is ready to count. */
  shown: number
  total: number
  counted: boolean
  active: boolean
  onSearch: (q: string) => void
  onChange: (patch: Partial<ListFilters>) => void
  onClear: () => void
}

const SOURCE_OPTIONS = SOURCE_FILTERS.map(s => ({ value: s, label: s === 'all' ? 'All sources' : s.toUpperCase() }))

export default function TransactionsToolbar({
  filters, categories, reviewCount, monthKnown, shown, total, counted, active, onSearch, onChange, onClear,
}: TransactionsToolbarProps) {
  const category = categories.find(c => c.id === filters.categoryId) ?? null

  return (
    <div className="tx-controls">
      <label className="tx-search">
        <Search size={16} aria-hidden="true" />
        <input
          className="field"
          type="search"
          placeholder="Search description or amount"
          aria-label="Search transactions"
          value={filters.q}
          onChange={e => onSearch(e.target.value)}
        />
      </label>

      <div className="seg tx-chips" role="group" aria-label="Filters">
        <button type="button" aria-pressed={filters.needsReview} onClick={() => onChange({ needsReview: !filters.needsReview })}>
          Needs review{reviewCount != null && <> <span className="num">{reviewCount}</span></>}
        </button>
        <button
          type="button"
          aria-pressed={filters.thisMonth}
          disabled={!monthKnown}
          onClick={() => onChange({ thisMonth: !filters.thisMonth })}
        >
          This month
        </button>
        <CategorySelect
          categories={categories}
          value={filters.categoryId}
          onChange={id => onChange({ categoryId: id })}
          renderTrigger={({ open, toggle }) => (
            <button type="button" aria-pressed={category != null} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
              {category ? category.name : 'Category'}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
        />
        <ChipMenu
          label="Source"
          options={SOURCE_OPTIONS}
          value={filters.source}
          neutral="all"
          onChange={source => onChange({ source })}
        />
        <button type="button" aria-pressed={filters.over100} onClick={() => onChange({ over100: !filters.over100 })}>
          Over €100
        </button>
      </div>

      <p className="tx-count" aria-live="polite">
        <span className="lab num">
          {!counted ? ' ' : active ? `${shown} of ${total}` : `${total} transaction${total === 1 ? '' : 's'}`}
        </span>
        {active && <button type="button" className="btn btn-sm" onClick={onClear}>Clear</button>}
      </p>
    </div>
  )
}
