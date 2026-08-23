import { useState } from 'react'
import { api } from '../api'
import { formatCents } from '../money'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'

const SOURCES = ['ing', 'revolut', 'degiro']

const BANK_ICONS: Record<string, React.ReactNode> = {
  ing: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  ),
  revolut: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  degiro: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
}

const fieldLabel = {
  display: 'block', marginBottom: 7,
  fontSize: 10.5, fontWeight: 700 as const,
  color: 'var(--text-label)',
  textTransform: 'uppercase' as const, letterSpacing: '0.1em',
}

export default function Import() {
  const [source, setSource] = useState('ing')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const handlePreview = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const data = await api.previewImport(source, file)
      setPreview(data)
      setResult(null)
    } catch (e) {
      setError(describeApiError(e))
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const data = await api.confirmImport(source, file)
      setResult(data)
      setPreview(null)
      setFile(null)
    } catch (e) {
      setError(describeApiError(e))
    } finally {
      setLoading(false)
    }
  }

  const newCount = preview ? preview.total - preview.duplicates : 0

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 4 }}>Import Transactions</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Upload a CSV from your bank to import and auto-categorise transactions</p>
      </div>

      {/* Upload form */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        maxWidth: 580,
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
        marginBottom: 20,
      }}>
        {/* Section heading */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>Upload CSV</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 1 }}>Supports ING, Revolut, DeGiro formats</div>
          </div>
        </div>

        {/* Bank source */}
        <div style={{ marginBottom: 16 }}>
          <label style={fieldLabel}>Bank source</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {SOURCES.map(s => (
              <button
                key={s}
                onClick={() => setSource(s)}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  padding: '9px 12px',
                  borderRadius: 'var(--radius)',
                  border: source === s ? '1px solid var(--accent-border)' : '1px solid var(--border-strong)',
                  background: source === s ? 'var(--accent-bg)' : 'var(--bg-input)',
                  color: source === s ? 'var(--accent-light)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 12.5, fontWeight: source === s ? 700 : 400,
                  fontFamily: 'var(--sans)',
                  transition: 'all 0.15s ease',
                  boxShadow: source === s ? '0 0 0 1px rgba(99,102,241,0.15)' : 'none',
                  letterSpacing: '0.01em',
                }}
              >
                {BANK_ICONS[s]}
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* File drop zone */}
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="csv-file" style={fieldLabel}>CSV file</label>
          <div
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const dropped = e.dataTransfer.files[0]
              if (dropped) { setFile(dropped); setPreview(null); setResult(null) }
            }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : file ? 'rgba(99,102,241,0.4)' : 'var(--border-strong)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '28px 20px',
              textAlign: 'center' as const,
              background: dragOver ? 'rgba(99,102,241,0.08)' : file ? 'rgba(99,102,241,0.05)' : 'var(--bg-input)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
              position: 'relative' as const,
              boxShadow: dragOver ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none',
            }}
          >
            {file ? (
              <div>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--accent-bg)', border: '1px solid var(--accent-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-light)', marginBottom: 4 }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {String(Math.round(file.size / 102.4) / 10)} KB · {source.toUpperCase()}
                </div>
              </div>
            ) : (
              <div>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(148,163,184,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
                  Drop a CSV here or <span style={{ color: 'var(--accent-light)' }}>click to browse</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>ING, Revolut, DeGiro formats supported</div>
              </div>
            )}
            <input
              id="csv-file" type="file" accept=".csv"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null) }}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </div>
        </div>

        {file && (
          <button
            onClick={handlePreview} disabled={loading}
            style={{
              background: loading ? 'var(--bg-input)' : 'var(--accent-bg)',
              color: loading ? 'var(--text-muted)' : 'var(--accent-light)',
              border: `1px solid ${loading ? 'var(--border)' : 'var(--accent-border)'}`,
              borderRadius: 'var(--radius)', padding: '10px 22px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--sans)',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? (
              <>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                Analysing…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                Preview Import
              </>
            )}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Preview */}
      {preview && (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          maxWidth: 800,
          border: '1px solid var(--border)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
          marginBottom: 20,
          animation: 'fadeIn 0.3s ease',
        }}>
          {/* Preview header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>Preview</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {preview.total} transactions found in file
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                fontSize: 11.5, fontWeight: 700, padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--green-bg)', color: 'var(--green)',
                border: '1px solid var(--green-border)',
              }}>
                {newCount} new
              </span>
              {preview.duplicates > 0 && (
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--orange-bg)', color: 'var(--orange)',
                  border: '1px solid var(--orange-border)',
                }}>
                  {preview.duplicates} duplicate
                </span>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflow: 'hidden', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-table-header)', borderBottom: '1px solid var(--border-strong)' }}>
                  {['Date', 'Description', 'Amount', 'Status'].map((h, i) => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: i === 2 ? 'right' : 'left',
                      fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r: any, i: number) => (
                  <tr key={i} style={{
                    borderBottom: i < preview.rows.length - 1 ? '1px solid var(--border)' : 'none',
                    opacity: r.duplicate ? 0.35 : 1,
                  }}>
                    <td style={{ padding: '10px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.date}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-h)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: r.amount_cents < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                      {r.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(r.amount_cents))}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        padding: '3px 9px', borderRadius: 'var(--radius-full)',
                        background: r.duplicate ? 'var(--orange-bg)' : 'var(--green-bg)',
                        color: r.duplicate ? 'var(--orange)' : 'var(--green)',
                        border: `1px solid ${r.duplicate ? 'var(--orange-border)' : 'var(--green-border)'}`,
                        letterSpacing: '0.04em',
                      }}>
                        {r.duplicate ? 'duplicate' : 'new'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleConfirm} disabled={loading || newCount === 0}
            style={{
              background: (loading || newCount === 0) ? 'var(--bg-input)' : 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: (loading || newCount === 0) ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: 'var(--radius)', padding: '11px 26px',
              cursor: (loading || newCount === 0) ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--sans)',
              boxShadow: (loading || newCount === 0) ? 'none' : '0 4px 16px rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all 0.2s ease',
              letterSpacing: '-0.01em',
            }}
          >
            {loading ? (
              <>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
                Importing…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Import {newCount} new transaction{newCount !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}

      {/* Success result */}
      {result && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.05)',
          border: '1px solid var(--green-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          maxWidth: 580,
          boxShadow: '0 0 24px rgba(34,197,94,0.08)',
          animation: 'fadeIn 0.4s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--green-bg)',
              border: '1px solid var(--green-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--green)', letterSpacing: '-0.02em' }}>Import Complete</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Transactions imported successfully</div>
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(34,197,94,0.15)', marginBottom: 16 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
            {[
              ['Imported', result.imported, 'var(--green)'],
              ['Skipped duplicates', result.skipped_duplicates, 'var(--text-secondary)'],
              ['Categorised by rule', result.categorised_by_rule, 'var(--accent-light)'],
              ['Categorised by AI', result.categorised_by_ai, 'var(--yellow)'],
              ['Uncategorised', result.uncategorised, 'var(--orange)'],
            ].map(([label, val, color]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: color as string, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
