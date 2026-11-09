/** The pages the palette and the "g then letter" jumps reach. */
export const PAGES = [
  { to: '/', label: 'Month', key: 'm' },
  { to: '/transactions', label: 'Transactions', key: 't' },
  { to: '/trends', label: 'Trends', key: 'r' },
  { to: '/setup', label: 'Setup', key: 's' },
  { to: '/import', label: 'Import', key: 'i' },
]

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'

/** Single-letter shortcuts stay out of the way of someone typing. */
export function isTyping(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** A sheet or the palette is open: only it takes keys. */
export function dialogOpen() {
  return !!document.querySelector('.scrim, [aria-modal="true"]')
}
