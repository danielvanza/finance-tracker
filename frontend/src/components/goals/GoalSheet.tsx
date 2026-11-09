import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { describeApiError } from '../ErrorBanner'
import { centsToInputString, parseToCents } from '../../money'
import type { Goal, GoalInput, SavingsCategory } from './types'

const MAX_NAME = 24
const MAX_CENTS = 99_999_999

const euroField = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : centsToInputString(cents))

interface Props {
  /** The goal being edited; leave out to add one. */
  goal?: Goal
  /** Savings categories that no other goal has taken. */
  categories: SavingsCategory[]
  onSave: (input: GoalInput) => Promise<void>
  onRemove?: () => Promise<void>
  onClose: () => void
}

export default function GoalSheet({ goal, categories, onSave, onRemove, onClose }: Props) {
  const [name, setName] = useState(goal?.name ?? '')
  const [categoryId, setCategoryId] = useState(goal?.category_id ?? categories[0]?.id ?? 0)
  const [target, setTarget] = useState(goal ? euroField(goal.target_cents) : '')
  const [by, setBy] = useState(goal?.by ?? '')
  const [start, setStart] = useState(goal ? euroField(goal.start_cents) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  // Escape closes; focus goes back to whatever opened the sheet.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(describeApiError(e))
      setBusy(false)
    }
  }

  const save = () => {
    const targetCents = parseToCents(target)
    const startCents = start.trim() === '' ? 0 : parseToCents(start)
    if (!name.trim()) return setError('Give the goal a name')
    if (!categoryId) return setError('Pick the savings category it is saved into')
    if (targetCents === null || targetCents <= 0 || targetCents > MAX_CENTS) return setError('Enter a target above zero')
    if (startCents === null || startCents < 0 || startCents > MAX_CENTS) return setError('Enter what is already saved, or leave it empty')
    if (by && !/^\d{4}-(0[1-9]|1[0-2])$/.test(by)) return setError('Enter the month as 2027-07, or leave it empty')
    run(() => onSave({
      name: name.trim(),
      category_id: categoryId,
      target_cents: targetCents,
      start_cents: startCents,
      by: by || null,
      // A goal keeps its start while it stays in the same category; a new pot starts today.
      ...(goal && goal.category_id === categoryId ? { started: goal.started } : {}),
    }))
  }

  const title = goal ? goal.name : 'New goal'

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={goal ? 'Edit goal' : 'New goal'} onClick={e => e.stopPropagation()}>
        <div className="tx-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form className="tx-form" onSubmit={e => { e.preventDefault(); save() }} noValidate>
          <div className="form-row">
            <label className="lab" htmlFor="goal-name">Name</label>
            <input id="goal-name" className="field" value={name} maxLength={MAX_NAME} autoFocus={!goal}
              onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <label className="lab" htmlFor="goal-category">Saved into</label>
            <select id="goal-category" className="field" value={categoryId} onChange={e => setCategoryId(Number(e.target.value))}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="goal-hint">Money moved into this category counts. One goal for each.</span>
          </div>
          <div className="tx-form-two">
            <div className="form-row">
              <label className="lab" htmlFor="goal-target">Target (€)</label>
              <input id="goal-target" className="field field-num" inputMode="decimal" value={target}
                onChange={e => setTarget(e.target.value)} />
            </div>
            <div className="form-row">
              <label className="lab" htmlFor="goal-by">By (optional)</label>
              <input id="goal-by" className="field" type="month" placeholder="2027-07" value={by}
                onChange={e => setBy(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label className="lab" htmlFor="goal-start">Already saved (€)</label>
            <input id="goal-start" className="field field-num" inputMode="decimal" value={start} placeholder="0"
              onChange={e => setStart(e.target.value)} />
            <span className="goal-hint">What was in the pot when the goal started. Later savings in the category are added to it.</span>
          </div>
        </form>

        {error && <p role="alert" className="tx-error">{error}</p>}

        <div className="sheet-actions">
          {onRemove && (
            <button type="button" className="btn btn-danger goal-remove" disabled={busy} onClick={() => run(onRemove)}>Remove</button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
