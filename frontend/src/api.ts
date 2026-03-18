const BASE = '/api'

export const api = {
  getDashboard: (month: string): Promise<import('./types').DashboardSummary> =>
    fetch(`${BASE}/dashboard/summary?month=${month}`).then(r => r.json()),

  previewImport: (source: string, file: File) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return fetch(`${BASE}/import/preview`, { method: 'POST', body: fd }).then(r => r.json())
  },

  confirmImport: (source: string, file: File) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return fetch(`${BASE}/import/confirm`, { method: 'POST', body: fd }).then(r => r.json())
  },

  getTransactions: (params: Record<string, string> = {}): Promise<import('./types').Transaction[]> => {
    const q = new URLSearchParams(params).toString()
    return fetch(`${BASE}/transactions${q ? '?' + q : ''}`).then(r => r.json())
  },

  getNextReview: (): Promise<import('./types').Transaction | null> =>
    fetch(`${BASE}/transactions/review`).then(r => r.json()),

  patchTransaction: (id: number, body: Partial<import('./types').Transaction>) =>
    fetch(`${BASE}/transactions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),

  createRuleFromTransaction: (id: number) =>
    fetch(`${BASE}/transactions/${id}/create-rule`, { method: 'POST' }).then(r => r.json()),

  getCategories: (): Promise<import('./types').Category[]> =>
    fetch(`${BASE}/categories`).then(r => r.json()),

  getBudget: (month: string): Promise<import('./types').BudgetRow[]> =>
    fetch(`${BASE}/budget?month=${month}`).then(r => r.json()),

  patchBudget: (id: number, planned_amount: number) =>
    fetch(`${BASE}/budget/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_amount }),
    }).then(r => r.json()),

  getRules: (): Promise<import('./types').Rule[]> =>
    fetch(`${BASE}/rules`).then(r => r.json()),

  createRule: (body: { pattern: string; category_id: number; priority: number }) =>
    fetch(`${BASE}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),

  deleteRule: (id: number) =>
    fetch(`${BASE}/rules/${id}`, { method: 'DELETE' }).then(r => r.json()),

  getSettings: (): Promise<import('./types').SettingsMap> =>
    fetch(`${BASE}/settings`).then(r => r.json()),

  patchSetting: (key: string, value: string) =>
    fetch(`${BASE}/settings/${key}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }).then(r => r.json()),
}
