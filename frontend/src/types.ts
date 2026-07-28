export interface TransactionSplit {
  id: number
  category_id: number | null
  category_name: string | null
  amount: number
}

export interface Transaction {
  id: number
  date: string
  amount: number
  description: string
  source: string
  category_id: number | null
  category_name: string | null
  confirmed: boolean
  categorised_by: string | null
  ai_confidence: number | null
  is_refund: boolean
  standing_adjustment_id: number | null
  splits: TransactionSplit[]
}

export interface SplitInput {
  category_id: number
  amount: number
}

export interface StandingAdjustment {
  id: number
  name: string
  amount: number
  income_category_id: number
  expense_category_id: number
  active: boolean
  start_month: string
}

export interface Category {
  id: number
  name: string
  type: string
  sort_order: number
}

export interface BudgetRow {
  id: number
  category_id: number
  category_name: string
  category_type: string
  month: string | null
  planned_amount: number
  actual_amount: number | null
}

export interface Rule {
  id: number
  pattern: string
  category_id: number
  category_name: string
  priority: number
}

export interface DashboardSummary {
  month: string
  total_income: number
  total_expenses: number
  total_savings: number
  left_over: number
  category_breakdown: Array<{
    category_id: number
    category_name: string
    actual: number
    planned: number
    type: string
  }>
  needs_wants_savings: { needs: number; wants: number; savings: number }
  monthly_trend: Array<{ month: string; total: number }>
  income_breakdown: Array<{
    category_id: number
    category_name: string
    amount: number
  }>
}

export interface SettingsMap {
  [key: string]: string
}
