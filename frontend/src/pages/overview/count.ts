import { useEffect, useRef, useState } from 'react'

const still = () =>
  typeof requestAnimationFrame !== 'function'
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

/** Counts a figure up to its value (from 0 the first time, then from the last value), easing out. */
export function useCountUp(target: number, ms = 700): number {
  const [shown, setShown] = useState(target)
  const from = useRef(0)
  useEffect(() => {
    if (still()) return
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms))
      const eased = 1 - Math.pow(1 - t, 4)
      setShown(Math.round(begin + (target - begin) * eased))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      from.current = target
    }
  }, [target, ms])
  return still() ? target : shown
}
