import { ChevronRight } from 'lucide-react'
import { merchantFor } from './merchantKey'
import { useMerchantSheet } from './useMerchantSheet'
import '../../styles/merchants.css'

/**
 * A transaction row's description: the clean shop name with the bank's own text beneath, opening
 * the merchant sheet. Put it inside the description cell. Outside a MerchantSheetProvider it
 * renders the plain description.
 */
export default function MerchantName({ description }: { description: string }) {
  const { open, available } = useMerchantSheet()
  if (!available) return <>{description}</>
  const { name } = merchantFor(description)
  const raw = description.trim()
  return (
    <button
      type="button"
      className="mer-open"
      title={raw}
      aria-label={`${name}: spend and history`}
      onClick={() => open(description)}
    >
      <span className="mer-name">
        <span className="mer-name-text">{name}</span>
        <ChevronRight className="mer-go" size={14} aria-hidden="true" />
      </span>
      {name.toLowerCase() !== raw.toLowerCase() && <span className="mer-raw">{raw}</span>}
    </button>
  )
}
