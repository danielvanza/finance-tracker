import type { MerchantView } from './types'
import '../../styles/merchants.css'

/** The Transactions | Merchants choice above the list. */
export default function ViewSwitch({ value, onChange }: { value: MerchantView; onChange: (v: MerchantView) => void }) {
  return (
    <div className="seg" role="group" aria-label="View">
      <button type="button" aria-pressed={value === 'transactions'} onClick={() => onChange('transactions')}>Transactions</button>
      <button type="button" aria-pressed={value === 'merchants'} onClick={() => onChange('merchants')}>Merchants</button>
    </div>
  )
}
