import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { applyTheme, themeAt, type Theme } from './theme'

const FADE_MS = 700

/** Day and night fade into each other in place: colours and shadows transition, nothing covers the page. */
function fadeTo(theme: Theme) {
  const root = document.documentElement
  root.classList.add('theme-fading')
  applyTheme(theme)
  window.setTimeout(() => root.classList.remove('theme-fading'), FADE_MS + 100)
}

/** Follows the device's light / dark setting; a flip from Find holds until the next sunrise or sunset. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now())
  const applied = useRef(false)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('storage', tick)
    const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    scheme?.addEventListener('change', tick)
    return () => {
      scheme?.removeEventListener('change', tick)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('storage', tick)
    }
  }, [])

  const theme = themeAt(now)

  useLayoutEffect(() => {
    if (!applied.current || document.hidden) applyTheme(theme)
    else if (document.documentElement.dataset.theme !== theme) fadeTo(theme)
    applied.current = true
  }, [theme])

  return children
}
