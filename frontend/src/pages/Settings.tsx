import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading, isError, error } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  const [startDay, setStartDay] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (settings?.financial_month_start_day) {
      setStartDay(settings.financial_month_start_day)
    }
  }, [settings])

  const mutation = useMutation({
    mutationFn: (value: string) => api.patchSetting('financial_month_start_day', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setSaveError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (e) => {
      setSaved(false)
      setSaveError(describeApiError(e))
    },
  })

  const handleSave = () => {
    const num = parseInt(startDay, 10)
    if (isNaN(num) || num < 1 || num > 28) return
    setSaveError('')
    mutation.mutate(startDay)
  }

  // Compute example period for current month
  const now = new Date()
  const dayNum = parseInt(startDay, 10)
  let exampleText = ''
  if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 28) {
    if (dayNum === 1) {
      exampleText = `1 ${now.toLocaleString('en-GB', { month: 'short' })} – ${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()} ${now.toLocaleString('en-GB', { month: 'short' })}`
    } else {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, dayNum)
      const endDay = dayNum - 1
      exampleText = `${dayNum} ${prevMonth.toLocaleString('en-GB', { month: 'short' })} – ${endDay} ${now.toLocaleString('en-GB', { month: 'short' })}`
    }
  }

  return (
    <section className="section">
      <h2>Financial month start day</h2>

      {isLoading && <span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading settings" />}
      {isError && <ErrorBanner message={describeApiError(error)} />}

      {settings && (
        <div className="panel setup-panel">
          <p className="setup-note">The day the salary arrives. Each financial month starts here.</p>

          <div className="setup-start">
            <div className="form-row setup-start-day">
              <label className="lab" htmlFor="start-day">Day</label>
              <input
                id="start-day"
                className="field field-num"
                type="number"
                min={1}
                max={28}
                value={startDay}
                onChange={e => setStartDay(e.target.value)}
              />
            </div>
            <button type="button" className="btn" onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="setup-saved">Saved</span>}
            {saveError && <span role="alert" className="setup-error">{saveError}</span>}
          </div>

          {exampleText && (
            <p className="well setup-example">
              Example period for {now.toLocaleString('en', { month: 'long', year: 'numeric' })}: <strong className="num">{exampleText}</strong>
            </p>
          )}

          <p className="setup-note">Between 1 and 28. Changing it redefines every past financial month too.</p>
        </div>
      )}
    </section>
  )
}
