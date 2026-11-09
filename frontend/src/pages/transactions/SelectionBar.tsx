import { ChevronDown, X } from 'lucide-react'
import type { Category, Transaction } from '../../types'
import CategorySelect from '../../components/CategorySelect'

interface SelectionBarProps {
  rows: Transaction[]
  categories: Category[]
  busy: boolean
  onConfirm: () => void
  onCategory: (id: number) => void
  onDelete: () => void
  onClear: () => void
}

/** The step you are on once rows are ticked: Confirm stays plain (weight 700), so the header keeps the one vermilion mark. */
export default function SelectionBar({ rows, categories, busy, onConfirm, onCategory, onDelete, onClear }: SelectionBarProps) {
  const toConfirm = rows.filter(t => !t.confirmed).length
  // The API only deletes manual rows.
  const allManual = rows.every(t => t.source === 'manual')

  return (
    <div className="tx-bar" role="region" aria-label="Selected transactions">
      <span className="lab num tx-bar-count">{rows.length} selected</span>
      <div className="tx-bar-actions">
        <button type="button" className="btn tx-bar-main" disabled={busy || toConfirm === 0} onClick={onConfirm}>
          Confirm {toConfirm}
        </button>
        <CategorySelect
          categories={categories}
          value={null}
          onChange={onCategory}
          renderTrigger={({ open, toggle }) => (
            <button type="button" className="btn" disabled={busy} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
              Category
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
        />
        {allManual && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>Delete {rows.length}</button>
        )}
        <button type="button" className="tx-close" aria-label="Clear selection" onClick={onClear}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
