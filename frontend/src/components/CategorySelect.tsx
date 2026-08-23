import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
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

export default function CategorySelect({ categories, value, onChange, placeholder = 'Select category\u2026', compact = false }: Props) {
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

  /* ── Sizing ── */
  const py = compact ? 6 : 9
  const fontSize = compact ? 12.5 : 13.5

  /* ── Portal position: track trigger button rect ── */
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!open || !containerRef.current) return
    const update = () => {
      const rect = containerRef.current!.getBoundingClientRect()
      // Use a wider panel for grid layout (min 360px, or trigger width if wider)
      const panelWidth = Math.max(rect.width, compact ? 320 : 400)
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
    <div ref={containerRef} style={{ position: 'relative' }} onKeyDown={handleKeyDown}>
      {/* ── Trigger button ── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-input)',
          color: selected ? 'var(--text-h)' : 'var(--text-muted)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius)',
          padding: `${py}px 34px ${py}px 12px`,
          fontSize, fontFamily: 'var(--sans)',
          cursor: 'pointer',
          transition: 'border-color 150ms cubic-bezier(0.16,1,0.3,1), box-shadow 150ms cubic-bezier(0.16,1,0.3,1)',
          boxShadow: open ? 'var(--shadow-input)' : 'none',
          textAlign: 'left',
          position: 'relative',
          outline: 'none',
          minHeight: compact ? 32 : 38,
        }}
      >
        {/* Icon */}
        {selected && SelectedIcon && meta && (
          <SelectedIcon
            size={compact ? 14 : 16}
            color={meta.color}
            strokeWidth={2}
            style={{ flexShrink: 0 }}
          />
        )}

        {/* Label */}
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontWeight: selected ? 500 : 400,
        }}>
          {selected ? selected.name : placeholder}
        </span>

        {/* Type badge */}
        {selected && meta && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: meta.color, background: meta.bg,
            border: `1px solid ${meta.border}`,
            padding: '1px 6px', borderRadius: 'var(--radius-xs)',
            lineHeight: '16px', flexShrink: 0,
          }}>
            {meta.label}
          </span>
        )}

        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12"
          style={{
            position: 'absolute', right: 11, top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)',
            pointerEvents: 'none',
          }}
        >
          <path fill="var(--text-secondary)" d="M6 8L1 3h10z" />
        </svg>
      </button>

      {/* ── Dropdown panel (portaled to body to escape overflow:hidden) ── */}
      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top, left: panelPos.left, width: panelPos.width,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
            zIndex: 9999,
            overflow: 'hidden',
            animation: 'categoryDropIn 180ms cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          {/* Search */}
          {categories.length > 6 && (
            <div style={{ padding: '8px 8px 0' }}>
              <div style={{ position: 'relative' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setHighlightIdx(0) }}
                   placeholder="Search categories…"
                  style={{
                    width: '100%',
                    background: 'var(--bg-input)',
                    color: 'var(--text-h)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '7px 10px 7px 30px',
                    fontSize: 12.5, fontFamily: 'var(--sans)',
                    outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                />
              </div>
            </div>
          )}

          {/* Option list - grid layout */}
          <div ref={listRef} role="listbox" style={{
            maxHeight: (panelPos?.maxHeight ?? 380) - 56, overflowY: 'auto', padding: '6px 0',
          }}>
            {grouped.length === 0 && (
              <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                No categories found
              </div>
            )}

            {grouped.map((group, gi) => {
              const gm = TYPE_META[group.type]
              return (
                <div key={group.type}>
                  {/* Group header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: `${gi === 0 ? 4 : 8}px 12px 4px`,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: gm.color, flexShrink: 0,
                      boxShadow: `0 0 5px ${gm.glow}`,
                    }} />
                    <span style={{
                      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.1em', color: gm.color, opacity: 0.85,
                    }}>
                      {gm.label}
                    </span>
                    <span style={{
                      flex: 1, height: 1,
                      background: `linear-gradient(90deg, ${gm.border}, transparent)`,
                    }} />
                  </div>

                  {/* Grid of items (2 columns) */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 2,
                    padding: '2px 6px 4px',
                  }}>
                    {group.items.map(cat => {
                      const flatIdx = flatItems.indexOf(cat)
                      const isHighlighted = flatIdx === highlightIdx
                      const isSelected = cat.id === value
                      const cm = TYPE_META[cat.type]
                      const Icon = getCategoryIcon(cat.name, cat.type)
                      return (
                        <div
                          key={cat.id}
                          data-idx={flatIdx}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => { onChange(cat.id); setOpen(false) }}
                          onMouseEnter={() => setHighlightIdx(flatIdx)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '6px 8px',
                            cursor: 'pointer',
                            borderRadius: 'var(--radius-sm)',
                            background: isHighlighted
                              ? cm.bg
                              : isSelected
                                ? 'rgba(99,102,241,0.08)'
                                : 'transparent',
                            transition: 'background 80ms ease',
                            border: isSelected
                              ? `1px solid ${cm.border}`
                              : '1px solid transparent',
                          }}
                        >
                          {/* Icon */}
                          <Icon
                            size={14}
                            color={isSelected || isHighlighted ? cm.color : 'var(--text-secondary)'}
                            strokeWidth={isSelected ? 2.2 : 1.8}
                            style={{
                              flexShrink: 0,
                              transition: 'color 80ms ease',
                            }}
                          />

                          {/* Name */}
                          <span style={{
                            flex: 1, fontSize: 12.5,
                            color: isSelected ? 'var(--text-h)' : 'var(--text)',
                            fontWeight: isSelected ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: '18px',
                          }}>
                            {cat.name}
                          </span>

                          {/* Selected check */}
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cm.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.9 }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
