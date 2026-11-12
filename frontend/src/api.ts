export const BASE = `${import.meta.env.BASE_URL}api`

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

export async function apiFetch<T>(pathTemplate: string, opts: { method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown } = {}): Promise<T> {
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

  getPace: (month?: string): Promise<import('./types').Pace> => {
    const q = month ? `month=${month}` : ''
    return apiFetch(`${BASE}/dashboard/pace${q ? '?' + q : ''}`, { method: 'GET' })
  },

  getTrends: (months: number, endMonth: string): Promise<import('./types').DashboardTrends> =>
    apiFetch(`${BASE}/dashboard/trends?months=${months}&end_month=${endMonth}`, { method: 'GET' }),

  previewImport: (file: File): Promise<import('./types').ImportPreviewResponse> => {
    const fd = new FormData()
    fd.append('file', file)
    return apiFetch(`${BASE}/import/preview`, { method: 'POST', body: fd })
  },

  confirmImport: (file: File): Promise<import('./types').ImportConfirmResponse> => {
    const fd = new FormData()
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

  patchTransaction: (id: number, body: Partial<Omit<import('./types').Transaction, 'splits'>> & { splits?: import('./types').SplitInput[]; remember?: boolean }) =>
    apiFetch(`${BASE}/transactions/${id}`, {
      method: 'PATCH',
      body,
    }),

  createTransaction: (body: { date: string; amount_cents: number; description: string; category_id: number; is_refund?: boolean }) =>
    apiFetch(`${BASE}/transactions`, {
      method: 'POST',
      body,
    }),

  deleteTransaction: (id: number) =>
    apiFetch(`${BASE}/transactions/${id}`, { method: 'DELETE' }),

  getSetAsides: (month?: string): Promise<import('./types').SetAsides> => {
    const q = month ? `month=${month}` : ''
    return apiFetch(`${BASE}/set-asides${q ? '?' + q : ''}`, { method: 'GET' })
  },

  createSetAside: (body: { name: string; amount_cents: number; due_month: string; every_months: number | null }): Promise<import('./types').SetAsides> =>
    apiFetch(`${BASE}/set-asides`, { method: 'POST', body }),

  deleteSetAside: (id: number): Promise<import('./types').SetAsides> =>
    apiFetch(`${BASE}/set-asides/${id}`, { method: 'DELETE' }),

  /** Say that a payment is this bill: it then comes out of what was set aside. */
  paySetAside: (id: number, transactionId: number): Promise<import('./types').SetAsides> =>
    apiFetch(`${BASE}/set-asides/${id}/payments`, { method: 'POST', body: { transaction_id: transactionId } }),

  unpaySetAside: (id: number, transactionId: number): Promise<import('./types').SetAsides> =>
    apiFetch(`${BASE}/set-asides/${id}/payments/${transactionId}`, { method: 'DELETE' }),

  ignoreBill: (key: string) =>
    apiFetch(`${BASE}/recurring/ignored`, { method: 'POST', body: { key } }),

  countBillAgain: (key: string) =>
    apiFetch(`${BASE}/recurring/ignored/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  getCategories: (): Promise<import('./types').Category[]> =>
    apiFetch(`${BASE}/categories`, { method: 'GET' }),

  getBudget: (month: string): Promise<import('./types').BudgetRow[]> =>
    apiFetch(`${BASE}/budget?month=${month}`, { method: 'GET' }),

  patchBudget: (id: number, planned_amount_cents: number) =>
    apiFetch(`${BASE}/budget/${id}`, {
      method: 'PATCH',
      body: { planned_amount_cents },
    }),

  patchCategory: (id: number, body: { type?: string; name?: string; force?: boolean }) =>
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

  createRule: (body: { pattern: string; category_id: number }) =>
    apiFetch(`${BASE}/rules`, {
      method: 'POST',
      body,
    }),

  deleteRule: (id: number) =>
    apiFetch(`${BASE}/rules/${id}`, { method: 'DELETE' }),

  /** Shops whose payments are always asked about: never sorted by themselves, never a rule. */
  getAskShops: (): Promise<import('./types').AskShop[]> =>
    apiFetch(`${BASE}/rules/ask-shops`, { method: 'GET' }),

  alwaysAsk: (transactionId: number): Promise<{ pattern: string; removed_rules: string[] }> =>
    apiFetch(`${BASE}/rules/ask-shops`, { method: 'POST', body: { transaction_id: transactionId } }),

  deleteAskShop: (pattern: string) =>
    apiFetch(`${BASE}/rules/ask-shops?pattern=${encodeURIComponent(pattern)}`, { method: 'DELETE' }),

  getSettings: (): Promise<import('./types').SettingsMap> =>
    apiFetch(`${BASE}/settings`, { method: 'GET' }),

  patchSetting: (key: string, value: string) =>
    apiFetch(`${BASE}/settings/${key}`, {
      method: 'PATCH',
      body: { value },
    }),

  getChat: (): Promise<import('./types').ChatConversation> =>
    apiFetch(`${BASE}/chat/messages?channel=bubble`, { method: 'GET' }),

  sendChatMessage: (body: { text?: string; choose_transaction_id?: number; seen_message_id?: number }): Promise<import('./types').ChatMessage> =>
    apiFetch(`${BASE}/chat/messages`, { method: 'POST', body: { channel: 'bubble', ...body } }),

  sendChatFile: (file: File): Promise<import('./types').ChatMessage> => {
    const fd = new FormData()
    fd.append('channel', 'bubble')
    fd.append('file', file)
    return apiFetch(`${BASE}/chat/files`, { method: 'POST', body: fd })
  },

  applyChatProposal: (id: number, version: string): Promise<import('./types').ChatCard> =>
    apiFetch(`${BASE}/chat/proposals/${id}/apply`, { method: 'POST', body: { version } }),

  rejectChatProposal: (id: number): Promise<import('./types').ChatCard> =>
    apiFetch(`${BASE}/chat/proposals/${id}/reject`, { method: 'POST' }),

  /** Make the shops an applied card sorted into rules, when the person asks for it. */
  rememberChatShops: (id: number): Promise<import('./types').ChatCard> =>
    apiFetch(`${BASE}/chat/proposals/${id}/remember`, { method: 'POST' }),

  chatChartUrl: (messageId: number, createdAt: string, theme: 'day' | 'night') =>
    `${BASE}/chat/messages/${messageId}/chart?theme=${theme}&v=${encodeURIComponent(createdAt)}`,

  newChat: () =>
    apiFetch(`${BASE}/chat/new`, { method: 'POST', body: { channel: 'bubble' } }),

  stopChat: (): Promise<{ stopped: number }> =>
    apiFetch(`${BASE}/chat/stop`, { method: 'POST', body: { channel: 'bubble' } }),
}
