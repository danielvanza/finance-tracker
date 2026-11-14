/** The pages the palette and the "g then letter" jumps reach. */
export const PAGES = [
  { to: '/', label: 'Month', key: 'm' },
  { to: '/transactions', label: 'Transactions', key: 't' },
  { to: '/trends', label: 'Trends', key: 'r' },
  { to: '/setup', label: 'Setup', key: 's' },
  { to: '/import', label: 'Import', key: 'i' },
]

/**
 * Settings and sheets Find can open when you type for them: what it says, where it lives, the route
 * (a `/setup#id` opens Setup on that section, ids in pages/Setup.tsx) and words that also find it.
 * Recurring payments and Savings goals are sheets that hide when empty, so they lead to their page.
 */
export const PLACES = [
  { label: 'Budget plan', sub: 'Setup · Budget', to: '/setup#budget', words: 'plan planned amounts month ahead next' },
  { label: 'Rules', sub: 'Setup · Rules', to: '/setup#rules', words: 'rule pattern shop sort' },
  { label: 'Categories', sub: 'Setup · Categories', to: '/setup#categories', words: 'category needs wants savings' },
  { label: 'Set-asides', sub: 'Setup · Set-asides', to: '/setup#set-asides', words: 'set aside bills yearly' },
  { label: 'Target split', sub: 'Setup · Target split', to: '/setup#target-split', words: 'aim 50/30/20 needs wants savings percent' },
  { label: 'Your own accounts', sub: 'Setup · Your own accounts', to: '/setup#own-accounts', words: 'personal names own' },
  { label: 'Financial month start day', sub: 'Setup · Settings', to: '/setup#month-start', words: 'payday salary period' },
  { label: 'Your data', sub: 'Setup · Your data', to: '/setup#your-data', words: 'export download csv backup' },
  { label: 'Month report', sub: 'Month · Report', to: '/report', words: 'summary print pdf' },
  { label: 'Recurring payments', sub: 'Month · Recurring', to: '/', words: 'subscriptions regular bills' },
  { label: 'Savings goals', sub: 'Trends · Savings goals', to: '/trends', words: 'goal target saving' },
]

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'

/** What the keys do, as the palette's "Keyboard shortcuts" lists it; useShellTools.tsx is where they are handled. */
export const SHORTCUTS = [
  { keys: `${MOD} K`, does: 'Find a page, a transaction or an action' },
  { keys: 'N', does: 'Add a transaction' },
  ...PAGES.map(p => ({ keys: `G then ${p.key.toUpperCase()}`, does: `Go to ${p.label}` })),
  { keys: '?', does: 'Show these shortcuts' },
]

/** Single-letter shortcuts stay out of the way of someone typing. */
export function isTyping(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** A sheet or the palette is open: only it takes keys. */
export function dialogOpen() {
  return !!document.querySelector('.scrim, [aria-modal="true"]')
}
