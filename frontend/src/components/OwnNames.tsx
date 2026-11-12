import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { describeApiError } from './ErrorBanner'

const FIELDS = 2

/** Setup > Your own accounts: the household's names as the bank shows them, so money moved to them is recognised. */
export default function OwnNames() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  // The fields start from what is saved, so they wait for it.
  return settings ? <NamesForm saved={settings.own_names ?? ''} /> : null
}

function NamesForm({ saved: savedNames }: { saved: string }) {
  const qc = useQueryClient()
  const [names, setNames] = useState<string[]>(() => {
    const given = savedNames.split(';').filter(Boolean)
    return [...given, ...Array(Math.max(0, FIELDS - given.length)).fill('')]
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => api.patchSetting('own_names', names.map(n => n.trim()).filter(Boolean).join(';')),
    onSuccess: () => {
      for (const key of ['settings', 'pace', 'budget', 'dashboard', 'transactions']) qc.invalidateQueries({ queryKey: [key] })
      setError('')
      setSaved(true)
    },
    onError: e => { setSaved(false); setError(describeApiError(e)) },
  })

  return (
    <section className="section" aria-labelledby="own-names-title">
      <h2 id="own-names-title">Your own accounts</h2>
      <div className="panel setup-panel">
        <p className="setup-note">
          Your names as the bank shows them on a transfer, such as "J Jansen". Money moved from the shared account
          to one of them is sorted into To personal accounts by itself and counts as spending.
        </p>
        <div className="setup-split">
          {names.map((name, i) => (
            <div className="form-row setup-own-name" key={i}>
              <label className="lab" htmlFor={`own-name-${i}`}>Name {i + 1}</label>
              <input
                id={`own-name-${i}`}
                className="field"
                value={name}
                onChange={e => { setNames(names.map((n, j) => (j === i ? e.target.value : n))); setSaved(false) }}
              />
            </div>
          ))}
          <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="setup-saved" role="status">Saved</span>}
        </div>
        {error && <p className="setup-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
