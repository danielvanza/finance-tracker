import { useEffect, useState } from 'react'

const readRem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

/** The root font size in px, re-read when the window resizes (page zoom) so sizes in rem stay true. */
export function useRem() {
  const [rem, setRem] = useState(readRem)
  useEffect(() => {
    const update = () => setRem(readRem())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return rem
}
