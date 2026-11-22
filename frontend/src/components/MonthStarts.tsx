import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { describeApiError } from './apiError'
import type { MonthStart } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

function labelsFrom(today: Date, startDay: number): { year: number; month: number }[] {
  const rolled = startDay > 1 && today.getDate() >= startDay ? 1 : 0
  return [0, 1, 2].map(i => {
    const d = new Date(today.getFullYear(), today.getMonth() + rolled + i, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })
}

function usualStart(year: number, month: number, startDay: number): string {
  if (startDay === 1) return `${year}-${pad(month)}-01`
  const d = new Date(year, month - 2, startDay)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(startDay)}`
}

function Row({ year, month, startDay, chosen }: { year: number; month: number; startDay: number; chosen?: MonthStart }) {
  const queryClient = useQueryClient()
  const usual = usualStart(year, month, startDay)
  const [typed, setTyped] = useState<string | null>(null)
  const [error, setError] = useState('')
  const value = typed ?? chosen?.start_date ?? usual

  const done = () => {
    setTyped(null)
    setError('')
    for (const key of ['month-starts', 'dashboard', 'budget', 'transactions']) queryClient.invalidateQueries({ queryKey: [key] })
  }
  const save = useMutation({ mutationFn: () => api.setMonthStart(year, month, value), onSuccess: done, onError: e => setError(describeApiError(e)) })
  const clear = useMutation({ mutationFn: () => api.clearMonthStart(year, month), onSuccess: done, onError: e => setError(describeApiError(e)) })
  const name = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  return (
    <div className="setup-start">
      <div className="form-row setup-start-day">
        <label className="lab" htmlFor={`month-start-${year}-${month}`}>{name} begins</label>
        <input id={`month-start-${year}-${month}`} className="field" type="date" value={value} onChange={e => setTyped(e.target.value)} />
      </div>
      <button type="button" className="btn" disabled={save.isPending || value === (chosen?.start_date ?? usual)} onClick={() => save.mutate()}>
        Set date
      </button>
      {chosen && (
        <button type="button" className="btn" disabled={clear.isPending} onClick={() => clear.mutate()}>
          Use usual day
        </button>
      )}
      {error && <span role="alert" className="setup-error">{error}</span>}
    </div>
  )
}

export default function MonthStarts({ startDay }: { startDay: number }) {
  const { data: chosen = [] } = useQuery({ queryKey: ['month-starts'], queryFn: api.getMonthStarts })
  if (!(startDay >= 1 && startDay <= 28)) return null
  return (
    <>
      <p className="setup-note">Salary came on another day? Pick the date a single month begins; the month before ends the day before.</p>
      {labelsFrom(new Date(), startDay).map(l => (
        <Row key={`${l.year}-${l.month}`} {...l} startDay={startDay} chosen={chosen.find(c => c.year === l.year && c.month === l.month)} />
      ))}
    </>
  )
}
