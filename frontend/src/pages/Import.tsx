import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, FileText, LoaderCircle, Upload } from 'lucide-react'
import { api } from '../api'
import type { ImportConfirmResponse, ImportPreviewResponse, Pace } from '../types'
import { dayLabel } from '../dates'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import Catchup from './import/Catchup'
import Preview from './import/Preview'
import Result from './import/Result'
import { BANKS } from './import/bank'
import { catchupPath, catchupProgress } from './import/catchup'

// A server rejection already says why the file could not be used and what is accepted.
const describeFailure = (e: unknown) => describeApiError(e)

export default function Import() {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<{ data: ImportConfirmResponse; bank: string } | null>(null)
  const [imported, setImported] = useState<string[]>([])
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const focusFileNext = useRef(false)

  const { data: pace } = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  // How things stood when the page opened: what this visit changed, and which banks the path lists.
  const [snapshot, setSnapshot] = useState<Pace | null>(null)
  if (pace && !snapshot) setSnapshot(pace)
  const path = snapshot ? catchupPath(snapshot) : null

  const source = 'ing'
  const loading = busy !== null

  useEffect(() => {
    if (result) resultHeading.current?.focus()
    else if (focusFileNext.current) {
      focusFileNext.current = false
      fileInput.current?.focus()
    }
  }, [result])

  const choose = (next: File | null) => {
    if (!next && fileInput.current) fileInput.current.value = ''
    setFile(next)
    setPreview(null)
    setResult(null)
  }

  const handlePreview = async () => {
    if (!file) return
    setBusy('preview')
    setError('')
    try {
      const data = await api.previewImport(file)
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
      const data = await api.confirmImport(file)
      // The freshness lines and Month read the pace; make them current.
      void qc.invalidateQueries({ queryKey: ['pace'] })
      setImported(list => [...list, source])
      setResult({ data, bank: source })
      setPreview(null)
      setFile(null)
    } catch (e) {
      setError(describeFailure(e))
    } finally {
      setBusy(null)
    }
  }

  const another = () => {
    focusFileNext.current = true
    setFile(null)
    setPreview(null)
    setError('')
    setResult(null)
  }

  const progress = path ? catchupProgress(path, pace ?? null, imported) : null

  return (
    <>
      <Link to="/" className="btn import-back">
        <ChevronLeft size={16} aria-hidden="true" />
        Back to Month
      </Link>

      <div className="page-head">
        <h1>Bring in an ING file</h1>
      </div>

      {path && <Catchup path={path} pace={pace} imported={imported} />}

      {!result && (
        <div className="import-steps">
          <section className="panel import-step">
            <h2>
              <label htmlFor="csv-file">Choose the ING file</label>
            </h2>
            <p className="import-hint">
              Export it from ING's website or app first, as a CSV file. English and Dutch exports both work.
              {pace?.newest_bank_date && <> Bank data runs to <strong className="num">{dayLabel(pace.newest_bank_date)}</strong>; rows already in are skipped.</>}
            </p>

            <div
              className={`well import-drop${dragOver ? ' is-over' : ''}`}
              onDragEnter={() => setDragOver(true)}
              onDragLeave={() => setDragOver(false)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                setDragOver(false)
                const dropped = e.dataTransfer.files[0]
                if (dropped) choose(dropped)
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
                ref={fileInput}
                className="import-file"
                type="file"
                accept=".csv"
                onChange={e => choose(e.target.files?.[0] ?? null)}
              />
            </div>

            {file && (
              <button
                type="button"
                className={`btn btn-wide${preview ? '' : ' btn-primary'}`}
                onClick={() => handlePreview()}
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
      )}

      {error && <ErrorBanner title="Couldn't process that file" message={error} />}

      {busy === 'preview' && !preview && (
        <span className="skeleton import-skeleton" aria-busy="true" aria-label="Reading the file" />
      )}

      {preview && (
        <Preview
          preview={preview}
          source={source}
          file={file}
          pace={pace}
          busy={busy === 'confirm'}
          loading={loading}
          onConfirm={handleConfirm}
          onAnother={() => { choose(null); fileInput.current?.focus() }}
        />
      )}

      {result && (
        <Result
          data={result.data}
          bank={result.bank}
          catchup={progress && { next: progress.next, toReview: pace?.to_review ?? 0 }}
          headingRef={resultHeading}
          onAgain={another}
        />
      )}
    </>
  )
}
