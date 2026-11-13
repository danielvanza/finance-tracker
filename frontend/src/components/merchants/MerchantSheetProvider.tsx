import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MerchantSheetContext } from './useMerchantSheet'
import { merchantFor } from './merchantKey'
import MerchantSheet from './MerchantSheet'

/** Holds the one merchant sheet for a page. Wrap the page; anything inside can call useMerchantSheet().open. */
export default function MerchantSheetProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<{ key: string; name: string } | null>(null)
  const control = useMemo(() => ({ open: (description: string) => setShop(merchantFor(description)), available: true }), [])
  const close = useCallback(() => setShop(null), [])
  return (
    <MerchantSheetContext.Provider value={control}>
      {children}
      {shop !== null && <MerchantSheet merchantKey={shop.key} name={shop.name} onClose={close} />}
    </MerchantSheetContext.Provider>
  )
}
