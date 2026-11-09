import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, FileText, LoaderCircle, Upload } from 'lucide-react'
import { api, ApiError } from '../api'
import type { ImportConfirmResponse, ImportPreviewResponse, Pace } from '../types'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import BankStep from './import/BankStep'
import Catchup from './import/Catchup'
import Preview from './import/Preview'
import Result from './import/Result'
import { BANKS } from './import/bank'
import { catchupPath, catchupProgress } from './import/catchup'
import { stalestBank } from './import/freshness'

// A network failure already says what to do; a server rejection usually means the wrong bank.
const describeFailure = (e: unknown) =>
  describeApiError(e) + (e instanceof ApiError && e.status > 0 ? ' Check the chosen bank matches the file, then try again.' : '')

export default function Import() {
  const qc = useQueryClient()
  // Until a bank is picked (or a file chosen), the one furthest behind is the choice.
  const [picked, setPicked] = useState<string | null>(null)
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

  const source = picked ?? stalestBank(pace) ?? 'ing'
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
    setPicked(source)
    setFile(next)
    setPreview(null)
    setResult(null)
  }

  const handlePreview = async (as = source) => {
    if (!file) return
    setBusy('preview')
    setError('')
    try {
      const data = await api.previewImport(as, file)
      setPicked(as)
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

  const another = (bank?: string) => {
    focusFileNext.current = true
    setPicked(bank ?? null)
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
        <h1>Bring in bank files</h1>
      </div>

      {path && <Catchup path={path} pace={pace} imported={imported} />}

      {!result && (
        <div className="import-steps">
          <BankStep
            source={source}
            onPick={s => { setPicked(s); setPreview(null) }}
            pace={pace}
            snapshot={snapshot}
          />

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
          onReadAs={bank => handlePreview(bank)}
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
