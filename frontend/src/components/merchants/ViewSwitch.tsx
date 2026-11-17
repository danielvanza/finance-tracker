import type { MerchantView } from './types'
import '../../styles/merchants.css'

/** Payments by shop instead of one by one: a toggle on the count line, and the way back from the shop view. */
export default function ViewSwitch({ value, onChange }: { value: MerchantView; onChange: (v: MerchantView) => void }) {
  const byShop = value === 'merchants'
  return (
    <button
      type="button"
      className="btn btn-sm btn-quiet mer-toggle"
      aria-pressed={byShop}
      onClick={() => onChange(byShop ? 'transactions' : 'merchants')}
    >
      By shop
    </button>
  )
}
