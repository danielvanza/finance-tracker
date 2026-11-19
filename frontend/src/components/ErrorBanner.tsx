import { CircleAlert, X } from 'lucide-react'

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
      <span className="notice-icon" aria-hidden="true"><CircleAlert size={18} /></span>
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
