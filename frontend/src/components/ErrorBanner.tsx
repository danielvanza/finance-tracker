import { ApiError } from '../api'

// Turn any thrown value from the api layer into one human sentence.
// Status 0 = network failure (see api.ts apiFetch).
export function describeApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) {
      return "Couldn't reach the server — check your connection and try again."
    }
    const detail = e.detail ?? (e.message.startsWith('Request failed') ? null : e.message)
    return detail ? `Server error ${e.status}: ${detail}` : `Server error ${e.status}.`
  }
  return 'Something went wrong — please try again.'
}

interface ErrorBannerProps {
  message: string
  title?: string
  onDismiss?: () => void
}

// Shared inline error banner (role="alert"). One implementation for every
// page-level failure surface; components with their own inline error <p>
// reuse describeApiError instead of mounting this.
export default function ErrorBanner({ message, title = 'Something went wrong', onDismiss }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(248,113,113,0.06)',
        border: '1px solid rgba(248,113,113,0.3)',
        borderRadius: 'var(--radius-lg)',
        padding: '13px 16px',
        marginBottom: 20,
        maxWidth: 580,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
      }}
    >
      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{message}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 15, lineHeight: 1,
            padding: 2, flexShrink: 0,
          }}
        >×</button>
      )}
    </div>
  )
}
