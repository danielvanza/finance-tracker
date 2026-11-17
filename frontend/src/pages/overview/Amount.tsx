import { useCountUp } from './count'

const GROUP = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })

/**
 * Money set for a headline: the euro sign and the cents smaller and lighter, the euros big.
 * Always a positive figure; the words around it say over or under.
 */
export function Amount({ cents, count = false, className }: { cents: number; count?: boolean; className?: string }) {
  const counted = useCountUp(Math.abs(cents))
  const abs = count ? counted : Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  const whole = Math.abs(cents)
  const label = `€${GROUP.format(Math.floor(whole / 100))},${String(whole % 100).padStart(2, '0')}`
  return (
    <span className={`amount ${className ?? ''}`} aria-label={label}>
      <small aria-hidden="true">€</small>
      <span aria-hidden="true">{GROUP.format(euros)}</span>
      <small aria-hidden="true">,{rest}</small>
    </span>
  )
}
