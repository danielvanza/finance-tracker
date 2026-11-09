import type { CategoryType } from '../../types'

export type ReportKind = 'needs' | 'wants' | 'savings'

/** One category in the report. All money is integer cents. */
export interface ReportRow {
  id: number
  name: string
  kind: ReportKind
  spent: number
  plan: number
  /** Spent in the month before; null when there is no month before to compare with. */
  before: number | null
}

export interface ReportGroup {
  kind: ReportKind
  label: string
  spent: number
  plan: number
  rows: ReportRow[]
}

export interface ReportMove {
  name: string
  /** spent minus spent before: positive is more, negative is less. */
  diff: number
  before: number
  spent: number
}

export interface ReportWhole {
  income: number
  incomeLines: Array<{ name: string; cents: number }>
  spent: number
  saved: number
  net: number
}

/** Everything the page and the copied text say, worked out once. */
export interface Report {
  month: string
  /** "24 Sep – 23 Oct 2026" */
  period: string
  /** "day 17 of 31" while the month is still running, else null. */
  dayNote: string | null
  status: 'ok' | 'gap' | 'empty'
  headline: string
  sentence: string
  /** Needs, wants, savings against plan. Empty unless the month is known. */
  kinds: Array<{ kind: ReportKind; label: string; spent: number; plan: number }>
  groups: ReportGroup[]
  /** The month before, named short ("Sep") and long ("September"); null when it cannot be compared. */
  compare: { short: string; long: string } | null
  more: ReportMove[]
  less: ReportMove[]
  whole: ReportWhole | null
  /** Confirmed and still-to-review transactions of this month; null when the list didn't load. */
  counts: { confirmed: number; toReview: number } | null
}

/** What a CSV row needs from a transaction (a structural subset of `Transaction`). */
export interface CsvTransaction {
  date: string
  description: string
  amount_cents: number
  source: string
  category_name: string | null
  confirmed: boolean
  is_refund: boolean
  splits: Array<{ category_name: string | null; amount_cents: number }>
}

export type { CategoryType }
