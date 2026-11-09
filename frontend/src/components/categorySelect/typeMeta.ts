export const TYPE_META: Record<string, { label: string }> = {
  needs:   { label: 'Needs' },
  wants:   { label: 'Wants' },
  savings: { label: 'Savings' },
  income:  { label: 'Income' },
  exclude: { label: 'Exclude' },
}

export const GROUP_ORDER = ['needs', 'wants', 'savings', 'income', 'exclude']
