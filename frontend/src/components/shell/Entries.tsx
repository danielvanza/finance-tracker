import { Plus, Search } from 'lucide-react'
import { MOD } from './keys'
import './shell-entries.css'

/** Find: a 44px chip in the phone's top row, a field in the desktop side panel. */
export function FindButtons({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button type="button" className="find-chip" aria-label="Find or do anything" aria-keyshortcuts="Control+K Meta+K" onClick={onOpen}>
        <Search size={18} aria-hidden="true" />
      </button>
      <button type="button" className="find-well" aria-keyshortcuts="Control+K Meta+K" onClick={onOpen}>
        <Search size={16} aria-hidden="true" />
        <span>Find anything</span>
        <kbd className="kbd">{MOD} K</kbd>
      </button>
    </>
  )
}

export function AddChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="add-chip" aria-label="Add transaction" aria-keyshortcuts="N" onClick={onOpen}>
      <Plus size={18} aria-hidden="true" />
    </button>
  )
}

export function AddRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="btn add-row" aria-keyshortcuts="N" onClick={onOpen}>
      <Plus size={16} aria-hidden="true" />
      <span>Add transaction</span>
      <kbd className="kbd">N</kbd>
    </button>
  )
}
