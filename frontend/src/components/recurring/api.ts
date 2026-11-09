import { useQuery } from '@tanstack/react-query'
import { apiFetch, BASE } from '../../api'
import type { Recurring } from './types'

export const getRecurring = (month: string): Promise<Recurring> =>
  apiFetch(`${BASE}/recurring?month=${month}`)

/** Shared by the link on Month and the sheet it opens, so one request serves both. */
export const useRecurring = (month: string) =>
  useQuery({ queryKey: ['recurring', month], queryFn: () => getRecurring(month), retry: false })
