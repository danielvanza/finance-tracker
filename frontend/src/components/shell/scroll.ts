import { useLayoutEffect, useRef } from 'react'

const calm = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Back to the page title: what tapping the tab you are already on does. */
export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: calm() ? 'smooth' : 'auto' })
}

/** A new page opens at its title, not wherever the last one was scrolled to. */
export function useOpenAtTop(pathname: string) {
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [pathname])
}
