/** Brings a panel that has just appeared to 1rem from the top of the page (its scroll-margin-top). */
export function showPanel(el: HTMLElement | null) {
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
}
