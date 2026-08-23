const BASE = '/api'

export class ApiError extends Error {
  readonly status: number      // HTTP status; 0 = network failure
  readonly detail: string | null
  constructor(status: number, message: string, detail: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function apiFetch<T>(pathTemplate: string, opts: { method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown } = {}): Promise<T> {
  try {
    const init: RequestInit = { method: opts.method ?? 'GET' }
    if (opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        init.body = opts.body                      // browser sets multipart boundary
      } else {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(opts.body)
      }
    }
    const res = await fetch(pathTemplate, init)
    if (!res.ok) {
      let detail: string | null = null
      try {
        const data = await res.json()
        if (data && typeof data.detail === 'string') detail = data.detail
      } catch { /* non-JSON body */ }
      throw new ApiError(res.status, detail ?? (res.statusText || `Request failed (${res.status})`), detail)
    }
    return res.json() as Promise<T>
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'Network error', null)
  }
}

export const api = {
  getDashboard: (month: string): Promise<import('./types').DashboardSummary> =>
    apiFetch(`${BASE}/dashboard/summary?month=${month}`, { method: 'GET' }),

  previewImport: (source: string, file: File): Promise<import('./types').ImportPreviewResponse> => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return apiFetch(`${BASE}/import/preview`, { method: 'POST', body: fd })
  },

  confirmImport: (source: string, file: File): Promise<import('./types').ImportConfirmResponse> => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return apiFetch(`${BASE}/import/confirm`, { method: 'POST', body: fd })
  },

  getTransactions: (params: Record<string, string> = {}): Promise<import('./types').Transaction[]> => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`${BASE}/transactions${q ? '?' + q : ''}`, { method: 'GET' })
  },

  getNextReview: (skipIds: number[] = []): Promise<import('./types').Transaction | null> => {
    const params = skipIds.length ? '?' + skipIds.map(id => `skip_ids=${id}`).join('&') : ''
    return apiFetch(`${BASE}/transactions/review${params}`, { method: 'GET' })
  },

  patchTransaction: (id: number, body: Partial<Omit<import('./types').Transaction, 'splits'>> & { splits?: import('./types').SplitInput[] }) =>
    apiFetch(`${BASE}/transactions/${id}`, {
      method: 'PATCH',
      body,
    }),

  createTransaction: (body: { date: string; amount_cents: number; description: string; category_id: number; is_refund?: boolean }) =>
    apiFetch(`${BASE}/transactions`, {
      method: 'POST',
      body,
    }),

  createAdjustmentPair: (body: { date: string; description: string; legs: Array<{ amount_cents: number; category_id: number; description?: string }> }) =>
    apiFetch(`${BASE}/transactions/adjustment-pair`, {
      method: 'POST',
      body,
    }),

  deleteTransaction: (id: number) =>
    apiFetch(`${BASE}/transactions/${id}`, { method: 'DELETE' }),

  getStandingAdjustments: (): Promise<import('./types').StandingAdjustment[]> =>
    apiFetch(`${BASE}/standing-adjustments`, { method: 'GET' }),

  createStandingAdjustment: (body: Partial<Omit<import('./types').StandingAdjustment, 'id'>>) =>
    apiFetch(`${BASE}/standing-adjustments`, {
      method: 'POST',
      body,
    }),

  patchStandingAdjustment: (id: number, body: Partial<Omit<import('./types').StandingAdjustment, 'id'>>) =>
    apiFetch(`${BASE}/standing-adjustments/${id}`, {
      method: 'PATCH',
      body,
    }),

  deleteStandingAdjustment: (id: number) =>
    apiFetch(`${BASE}/standing-adjustments/${id}`, { method: 'DELETE' }),

  createRuleFromTransaction: (id: number) =>
    apiFetch(`${BASE}/transactions/${id}/create-rule`, { method: 'POST' }),

  getCategories: (): Promise<import('./types').Category[]> =>
    apiFetch(`${BASE}/categories`, { method: 'GET' }),

  getBudget: (month: string): Promise<import('./types').BudgetRow[]> =>
    apiFetch(`${BASE}/budget?month=${month}`, { method: 'GET' }),

  patchBudget: (id: number, planned_amount_cents: number) =>
    apiFetch(`${BASE}/budget/${id}`, {
      method: 'PATCH',
      body: { planned_amount_cents },
    }),

  patchCategory: (id: number, body: { type?: string; name?: string }) =>
    apiFetch(`${BASE}/categories/${id}`, {
      method: 'PATCH',
      body,
    }),

  createCategory: (body: { name: string; type: string; sort_order?: number }) =>
    apiFetch(`${BASE}/categories`, {
      method: 'POST',
      body,
    }),

  deleteCategory: (id: number) =>
    apiFetch(`${BASE}/categories/${id}`, { method: 'DELETE' }),

  reorderCategories: (categoryIds: number[]) =>
    apiFetch(`${BASE}/categories/reorder`, {
      method: 'PATCH',
      body: { category_ids: categoryIds },
    }),

  getRules: (): Promise<import('./types').Rule[]> =>
    apiFetch(`${BASE}/rules`, { method: 'GET' }),

  createRule: (body: { pattern: string; category_id: number; priority: number }) =>
    apiFetch(`${BASE}/rules`, {
      method: 'POST',
      body,
    }),

  deleteRule: (id: number) =>
    apiFetch(`${BASE}/rules/${id}`, { method: 'DELETE' }),

  getSettings: (): Promise<import('./types').SettingsMap> =>
    apiFetch(`${BASE}/settings`, { method: 'GET' }),

  patchSetting: (key: string, value: string) =>
    apiFetch(`${BASE}/settings/${key}`, {
      method: 'PATCH',
      body: { value },
    }),
}
