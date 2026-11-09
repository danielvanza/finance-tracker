import { X } from 'lucide-react'
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
    <div role="alert" className="notice notice-error">
      <div className="notice-body">
        <strong>{title}</strong>
        {message}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error">
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
