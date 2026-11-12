import { useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../api'
import { describeApiError } from '../ErrorBanner'
import { csvFilename, downloadCsv } from './csv'
import '../../styles/reports.css'

/**
 * The "Your data" section at the end of Setup: every transaction as a CSV. It takes no props and
 * is a `section` for `.setup-sections`: `<YourData />` after `<Settings />`.
 */
export default function YourData() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const allTransactions = async () => {
    setBusy(true)
    setError('')
    try {
      downloadCsv(await api.getTransactions(), csvFilename('transactions'))
    } catch (e) {
      setError(describeApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section rep-data">
      <h2>Your data</h2>
      <div className="panel setup-panel">
        <p className="setup-note">
          This file is for a spreadsheet. The database file on the server is the real backup.
        </p>
        <div className="rep-data-rows">
          <button type="button" className="link-row rep-data-row" disabled={busy} onClick={allTransactions}>
            <span>All transactions<small>{busy ? 'Getting them…' : 'A CSV file with every month'}</small></span>
            <Download size={16} aria-hidden="true" />
          </button>
        </div>
        {error && <p className="setup-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
