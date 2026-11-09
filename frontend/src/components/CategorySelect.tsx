import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { Category } from '../types'
import { getCategoryIcon } from './categorySelect/icons'
import { TYPE_META, GROUP_ORDER } from './categorySelect/typeMeta'

export { TYPE_META, GROUP_ORDER } from './categorySelect/typeMeta'

interface Props {
  categories: Category[]
  value: number | null
  onChange: (id: number) => void
  placeholder?: string
  /** Compact mode for inline/table usage */
  compact?: boolean
}

export default function CategorySelect({ categories, value, onChange, placeholder = 'Select category…', compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = categories.find(c => c.id === value) ?? null

  /* ── Group categories by type ── */
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim()
    const filtered = q ? categories.filter(c => c.name.toLowerCase().includes(q)) : categories
    const groups: { type: string; items: Category[] }[] = []
    for (const t of GROUP_ORDER) {
      const items = filtered.filter(c => c.type === t)
      if (items.length) groups.push({ type: t, items })
    }
    return groups
  }, [categories, search])

  /* Flat list for keyboard navigation */
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped])

  /* ── Close on outside click ── */
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  /* Focus search when opening */
  useEffect(() => {
    if (open) {
      setSearch('')
      setHighlightIdx(-1)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open])

  /* Scroll highlighted item into view */
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIdx(i => (i + 1) % flatItems.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIdx(i => (i - 1 + flatItems.length) % flatItems.length)
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIdx >= 0 && flatItems[highlightIdx]) {
          onChange(flatItems[highlightIdx].id)
          setOpen(false)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }, [open, highlightIdx, flatItems, onChange])

  const meta = selected ? TYPE_META[selected.type] : null

  /* ── Portal position: track trigger button rect ── */
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!open || !containerRef.current) return
    const update = () => {
      const rect = containerRef.current!.getBoundingClientRect()
      // Use a wider panel for grid layout (min 360px, or trigger width if wider)
      const panelWidth = Math.min(Math.max(rect.width, compact ? 320 : 400), window.innerWidth - 16)
      // Centre the panel horizontally relative to the trigger
      const left = rect.left - (panelWidth - rect.width) / 2
      // Clamp so it doesn't go off-screen horizontally
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
      // Decide whether to open below or above
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const panelMaxHeight = 420 // upper bound
      if (spaceBelow >= Math.min(panelMaxHeight, 200) || spaceBelow >= spaceAbove) {
        // Open below
        const maxHeight = Math.min(panelMaxHeight, spaceBelow)
        setPanelPos({ top: rect.bottom + 6, left: clampedLeft, width: panelWidth, maxHeight })
      } else {
        // Flip above
        const maxHeight = Math.min(panelMaxHeight, spaceAbove)
        setPanelPos({ top: rect.top - 6 - Math.min(panelMaxHeight, spaceAbove), left: clampedLeft, width: panelWidth, maxHeight })
      }
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, compact])

  /* ── Selected icon ── */
  const SelectedIcon = selected ? getCategoryIcon(selected.name, selected.type) : null

  return (
    <div ref={containerRef} className="cs" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`cs-trigger${compact ? ' is-compact' : ''}${selected ? '' : ' is-empty'}`}
      >
        {selected && SelectedIcon && (
          <SelectedIcon className="cs-icon" size={compact ? 14 : 16} aria-hidden="true" />
        )}
        <span className="cs-label">{selected ? selected.name : placeholder}</span>
        {selected && meta && <span className="cs-badge">{meta.label}</span>}
        <ChevronDown className="cs-chevron" size={14} aria-hidden="true" />
      </button>

      {/* Portaled to body to escape overflow:hidden */}
      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          className="cs-panel"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        >
          {categories.length > 6 && (
            <div className="cs-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                className="field"
                value={search}
                onChange={e => { setSearch(e.target.value); setHighlightIdx(0) }}
                placeholder="Search categories…"
              />
            </div>
          )}

          <div
            ref={listRef}
            role="listbox"
            className="cs-list"
            style={{ maxHeight: (panelPos?.maxHeight ?? 380) - 56 }}
          >
            {grouped.length === 0 && <div className="empty">No categories found</div>}

            {grouped.map(group => (
              <div key={group.type}>
                <div className="lab cs-group">{TYPE_META[group.type].label}</div>
                <div className="cs-grid">
                  {group.items.map(cat => {
                    const flatIdx = flatItems.indexOf(cat)
                    const isSelected = cat.id === value
                    const Icon = getCategoryIcon(cat.name, cat.type)
                    return (
                      <div
                        key={cat.id}
                        data-idx={flatIdx}
                        role="option"
                        aria-selected={isSelected}
                        className={`cs-opt${flatIdx === highlightIdx ? ' is-hi' : ''}${isSelected ? ' is-sel' : ''}`}
                        onClick={() => { onChange(cat.id); setOpen(false) }}
                        onMouseEnter={() => setHighlightIdx(flatIdx)}
                      >
                        <Icon className="cs-icon" size={14} aria-hidden="true" />
                        <span className="cs-label">{cat.name}</span>
                        {isSelected && <Check className="cs-check" size={13} aria-hidden="true" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
