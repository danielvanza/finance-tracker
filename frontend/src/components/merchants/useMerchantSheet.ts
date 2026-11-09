import { createContext, useContext } from 'react'

export interface MerchantSheetControl {
  /** Opens the merchant sheet for the shop behind a bank description. */
  open: (description: string) => void
  /** False outside a MerchantSheetProvider: rows then stay plain text. */
  available: boolean
}

export const MerchantSheetContext = createContext<MerchantSheetControl>({ open: () => {}, available: false })

export const useMerchantSheet = () => useContext(MerchantSheetContext)
