import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MerchantSheetContext } from './useMerchantSheet'
import { merchantFor } from './merchantKey'
import MerchantSheet from './MerchantSheet'

/** Holds the one merchant sheet for a page. Wrap the page; anything inside can call useMerchantSheet().open. */
export default function MerchantSheetProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<string | null>(null)
  const control = useMemo(() => ({ open: (description: string) => setKey(merchantFor(description).key), available: true }), [])
  const close = useCallback(() => setKey(null), [])
  return (
    <MerchantSheetContext.Provider value={control}>
      {children}
      {key !== null && <MerchantSheet merchantKey={key} onClose={close} />}
    </MerchantSheetContext.Provider>
  )
}
