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
