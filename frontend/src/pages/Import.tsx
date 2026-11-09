import { useQuery } from '@tanstack/react-query'
import { dayLabel } from '../dates'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, FileText, LoaderCircle, Upload } from 'lucide-react'
import { api, ApiError } from '../api'
import { formatCents } from '../money'
import type { ImportConfirmResponse, ImportPreviewResponse } from '../types'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'

const SOURCES = ['ing', 'revolut', 'degiro']
const BANKS: Record<string, string> = { ing: 'ING', revolut: 'Revolut', degiro: 'DEGIRO' }

// A network failure already says what to do; a server rejection usually means the wrong bank.
const describeFailure = (e: unknown) =>
  describeApiError(e) + (e instanceof ApiError && e.status > 0 ? ' Check the chosen bank matches the file, then try again.' : '')

export default function Import() {
  const [source, setSource] = useState('ing')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<ImportConfirmResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const { data: pace } = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const lastFile = pace?.last_import_by_bank.find(b => b.source === source)?.last_date

  const loading = busy !== null

  const handlePreview = async () => {
    if (!file) return
    setBusy('preview')
    setError('')
    try {
      const data = await api.previewImport(source, file)
      setPreview(data)
      setResult(null)
    } catch (e) {
      setError(describeFailure(e))
    } finally {
      setBusy(null)
    }
  }

  const handleConfirm = async () => {
    if (!file) return
    setBusy('confirm')
    setError('')
    try {
      const data = await api.confirmImport(source, file)
      setResult(data)
      setPreview(null)
      setFile(null)
    } catch (e) {
      setError(describeFailure(e))
    } finally {
      setBusy(null)
    }
  }

  const newCount = preview ? preview.total - preview.duplicates : 0
  // Rule matches are confirmed on import; guesses and anything left over need a person.
  const toReview = result ? result.categorised_by_ai + result.uncategorised : 0

  return (
    <>
      <Link to="/" className="btn import-back">
        <ChevronLeft size={16} aria-hidden="true" />
        Back to Month
      </Link>

      <div className="page-head">
        <h1>Bring in bank files</h1>
      </div>

      <div className="import-steps">
        <section className="panel import-step" aria-labelledby="import-step-bank">
          <h2 id="import-step-bank"><span className="import-num">1</span> Choose the bank</h2>
          <div className="seg import-banks" role="group" aria-labelledby="import-step-bank">
            {SOURCES.map(s => (
              <button key={s} type="button" aria-pressed={source === s} onClick={() => { setSource(s); setPreview(null) }}>
                {BANKS[s]}
              </button>
            ))}
          </div>
          {pace && (
            <p className="import-hint">
              {lastFile ? `The last ${BANKS[source]} file reached ${dayLabel(lastFile)}.` : `No ${BANKS[source]} file yet.`}
            </p>
          )}
        </section>

        <section className="panel import-step">
          <h2>
            <span className="import-num">2</span> <label htmlFor="csv-file">Choose the CSV file</label>
          </h2>
          <p className="import-hint">Export it from the bank's website or app first.</p>

          <div
            className={`well import-drop${dragOver ? ' is-over' : ''}`}
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const dropped = e.dataTransfer.files[0]
              if (dropped) { setFile(dropped); setPreview(null); setResult(null) }
            }}
          >
            {file ? (
              <>
                <FileText size={20} aria-hidden="true" />
                <strong>{file.name}</strong>
                <span className="muted num">
                  {String(Math.round(file.size / 102.4) / 10)} KB · {BANKS[source]}
                </span>
              </>
            ) : (
              <>
                <Upload size={20} aria-hidden="true" />
                <strong>Choose a file</strong>
                <span className="muted">or drop one here</span>
              </>
            )}
            <input
              id="csv-file"
              className="import-file"
              type="file"
              accept=".csv"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null) }}
            />
          </div>

          {file && (
            <button
              type="button"
              className={`btn btn-wide${preview ? '' : ' btn-primary'}`}
              onClick={handlePreview}
              disabled={loading}
            >
              {busy === 'preview' ? (
                <>
                  <LoaderCircle size={16} className="import-spin" aria-hidden="true" />
                  Analysing…
                </>
              ) : (
                'Preview import'
              )}
            </button>
          )}
        </section>
      </div>

      {error && <ErrorBanner title="Couldn't process that file" message={error} />}

      {busy === 'preview' && !preview && (
        <span className="skeleton import-skeleton" aria-busy="true" aria-label="Reading the file" />
      )}

      {preview && (
        <section className="panel import-preview" aria-labelledby="import-step-confirm">
          <div className="import-preview-head">
            <div>
              <h2 id="import-step-confirm"><span className="import-num">3</span> Check and confirm</h2>
              <p className="import-counts num">
                {preview.total} transaction{preview.total === 1 ? '' : 's'} in the file
                {': '}<span className="import-new">{newCount} new</span>
                {preview.duplicates > 0 && `, ${preview.duplicates} duplicate`}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={loading || newCount === 0}
            >
              {busy === 'confirm' ? (
                <>
                  <LoaderCircle size={16} className="import-spin" aria-hidden="true" />
                  Importing…
                </>
              ) : newCount === 0 ? (
                'Nothing new to import'
              ) : (
                `Import ${newCount} new transaction${newCount !== 1 ? 's' : ''}`
              )}
            </button>
          </div>

          {preview.rows.length === 0 ? (
            <p className="empty">No transactions found in this file. Check the bank matches the file, then try again.</p>
          ) : (
            <table className="table card-table import-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className={r.duplicate ? 'is-duplicate' : undefined}>
                    <td className="num import-date">{r.date}</td>
                    <td className="strong import-desc" title={r.description}>{r.description}</td>
                    <td className={`right strong num${r.amount_cents < 0 ? '' : ' is-in'}`}>
                      {r.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(r.amount_cents))}
                    </td>
                    <td className="import-status">{r.duplicate ? 'duplicate' : 'new'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {result && (
        <section className="panel import-result" role="status" aria-labelledby="import-result-title">
          <h2 id="import-result-title">Import finished</h2>
          <dl className="import-tally num">
            <div><dt>Imported</dt><dd>{result.imported}</dd></div>
            <div><dt>Skipped duplicates</dt><dd>{result.skipped_duplicates}</dd></div>
            <div><dt>Categorised by rule</dt><dd>{result.categorised_by_rule}</dd></div>
            <div><dt>Categorised by AI</dt><dd>{result.categorised_by_ai}</dd></div>
            <div><dt>Uncategorised</dt><dd>{result.uncategorised}</dd></div>
          </dl>
          {toReview > 0 ? (
            <Link to="/transactions" className="btn btn-primary btn-wide">
              Review {toReview} transaction{toReview === 1 ? '' : 's'}
            </Link>
          ) : (
            <Link to="/" className="btn btn-primary btn-wide">See the month</Link>
          )}
        </section>
      )}
    </>
  )
}
