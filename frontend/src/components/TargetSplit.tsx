import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { describeApiError } from './ErrorBanner'
import { parseSplit } from './budget/plan'

const LABELS = ['Needs', 'Wants', 'Savings']

/** Setup > Target split: the share of income the household aims to put to needs, wants and savings. */
export default function TargetSplit() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  // The fields start from what is saved, so they wait for it.
  return settings ? <SplitForm saved={settings.target_split} /> : null
}

function SplitForm({ saved: savedSplit }: { saved: string | undefined }) {
  const qc = useQueryClient()
  const [parts, setParts] = useState<string[]>(() => parseSplit(savedSplit).map(String))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const numbers = parts.map(p => (/^\d{1,3}$/.test(p.trim()) ? Number(p) : NaN))
  const total = numbers.reduce((sum, n) => sum + n, 0)
  const valid = numbers.every(n => !Number.isNaN(n)) && total === 100

  const save = useMutation({
    mutationFn: () => api.patchSetting('target_split', numbers.join('/')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setError('')
      setSaved(true)
    },
    onError: e => { setSaved(false); setError(describeApiError(e)) },
  })

  return (
    <section className="section" aria-labelledby="target-split-title">
      <h2 id="target-split-title">Target split</h2>
      <div className="panel setup-panel">
        <p className="setup-note">
          How you aim to divide your income between needs, wants and savings, in percent. The Month page and the
          budget above measure against it. It starts at 50/30/20; set what fits your household.
        </p>
        <div className="setup-split">
          {LABELS.map((label, i) => (
            <div className="form-row" key={label}>
              <label className="lab" htmlFor={`split-${i}`}>{label} %</label>
              <input
                id={`split-${i}`}
                className="field field-num"
                inputMode="numeric"
                value={parts[i]}
                onChange={e => { setParts(parts.map((p, j) => (j === i ? e.target.value : p))); setSaved(false) }}
              />
            </div>
          ))}
          <button type="button" className="btn" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="setup-saved" role="status">Saved</span>}
        </div>
        {!valid && (
          <p className="setup-error" role="alert">
            The three must be whole numbers that add up to 100{Number.isNaN(total) ? '.' : `; these add up to ${total}.`}
          </p>
        )}
        {error && <p className="setup-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
