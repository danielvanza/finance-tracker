import { useState } from 'react'
import { api } from '../api'

const SOURCES = ['ing', 'revolut', 'degiro']

export default function Import() {
  const [source, setSource] = useState('ing')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)

  const handlePreview = async () => {
    if (!file) return
    setLoading(true)
    const data = await api.previewImport(source, file)
    setPreview(data)
    setResult(null)
    setLoading(false)
  }

  const handleConfirm = async () => {
    if (!file) return
    setLoading(true)
    const data = await api.confirmImport(source, file)
    setResult(data)
    setPreview(null)
    setFile(null)
    setLoading(false)
  }

  return (
    <div>
      <h1>Import Transactions</h1>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 24, maxWidth: 600 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#888' }}>Source</label>
          <select value={source} onChange={e => setSource(e.target.value)}
            style={{ background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', width: '100%' }}>
            {SOURCES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="csv-file" style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#888' }}>CSV file</label>
          <input id="csv-file" type="file" accept=".csv"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null) }}
            style={{ color: '#e0e0e0' }} />
        </div>

        {file && (
          <button onClick={handlePreview} disabled={loading}
            style={{ background: '#374151', color: '#e0e0e0', border: 'none', borderRadius: 6, padding: '10px 20px', cursor: 'pointer', marginRight: 10 }}>
            {loading ? 'Loading...' : 'Preview'}
          </button>
        )}
      </div>

      {preview && (
        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 24, maxWidth: 800, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Preview — {preview.total} transactions ({preview.duplicates} duplicates)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#888', textAlign: 'left', borderBottom: '1px solid #333' }}>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Description</th>
                <th style={{ padding: '6px 8px' }}>Amount</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #222', opacity: r.duplicate ? 0.4 : 1 }}>
                  <td style={{ padding: '6px 8px' }}>{r.date}</td>
                  <td style={{ padding: '6px 8px' }}>{r.description}</td>
                  <td style={{ padding: '6px 8px', color: r.amount < 0 ? '#f87171' : '#4ade80' }}>
                    €{Math.abs(r.amount).toFixed(2)}
                  </td>
                  <td style={{ padding: '6px 8px', color: r.duplicate ? '#f97316' : '#4ade80' }}>
                    {r.duplicate ? 'duplicate' : 'new'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleConfirm} disabled={loading}
            style={{ marginTop: 16, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Importing...' : `Import ${preview.total - preview.duplicates} new transactions`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ background: '#0f2d0f', border: '1px solid #4ade80', borderRadius: 8, padding: 24, maxWidth: 600, marginTop: 24 }}>
          <h3 style={{ marginTop: 0, color: '#4ade80' }}>Import Complete</h3>
          <p>Imported: {result.imported} | Skipped (duplicates): {result.skipped_duplicates}</p>
          <p>Categorised by rule: {result.categorised_by_rule} | By AI: {result.categorised_by_ai} | Uncategorised: {result.uncategorised}</p>
        </div>
      )}
    </div>
  )
}
