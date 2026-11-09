// Day (Washi Clay) and night (Charcoal Clay) follow the real sun in Amsterdam. Tapping the
// daylight dot flips the theme until the next sunrise or sunset; flipping back returns to auto.

export type Theme = 'day' | 'night'

// Amsterdam. The sun, not the clock, decides; the browser's zone only picks the calendar day.
const LAT = 52.37
const LON = 4.9
const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const OVERRIDE_KEY = 'life.theme-override'

/** Sunrise and sunset (epoch ms) on the given local day: the standard sunrise equation. */
export function sunTimes(day: Date): { sunrise: number; sunset: number } {
  const noon = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12)
  const n = Math.round(noon / DAY_MS + 2440587.5 - 2451545 + 0.0008)
  const meanNoon = n - LON / 360
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360
  const center =
    1.9148 * Math.sin(anomaly * RAD) + 0.02 * Math.sin(2 * anomaly * RAD) + 0.0003 * Math.sin(3 * anomaly * RAD)
  const longitude = (anomaly + center + 180 + 102.9372) % 360
  const transit = 2451545 + meanNoon + 0.0053 * Math.sin(anomaly * RAD) - 0.0069 * Math.sin(2 * longitude * RAD)
  const declination = Math.asin(Math.sin(longitude * RAD) * Math.sin(23.4397 * RAD))
  const cosHour =
    (Math.sin(-0.833 * RAD) - Math.sin(LAT * RAD) * Math.sin(declination)) / (Math.cos(LAT * RAD) * Math.cos(declination))
  const hour = Math.acos(Math.max(-1, Math.min(1, cosHour))) / RAD / 360
  const ms = (julian: number) => (julian - 2440587.5) * DAY_MS
  return { sunrise: ms(transit - hour), sunset: ms(transit + hour) }
}

function localDay(now: number, offset: number) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12)
}

/** The natural period `now` falls in: day from sunrise to sunset, night from sunset to sunrise. */
export type Daylight = { natural: Theme; from: number; to: number }

export function daylightAt(now: number): Daylight {
  const today = sunTimes(localDay(now, 0))
  if (now < today.sunrise) return { natural: 'night', from: sunTimes(localDay(now, -1)).sunset, to: today.sunrise }
  if (now < today.sunset) return { natural: 'day', from: today.sunrise, to: today.sunset }
  return { natural: 'night', from: today.sunset, to: sunTimes(localDay(now, 1)).sunrise }
}

// A manual flip is kept per browser until the next natural change.

export function readOverride(now: number): Theme | null {
  try {
    const saved = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? 'null')
    if (saved && now < saved.until && (saved.theme === 'day' || saved.theme === 'night')) return saved.theme
  } catch {
    // unreadable or blocked storage: auto
  }
  return null
}

export function setOverride(theme: Theme | null, until: number) {
  try {
    if (theme) localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ theme, until }))
    else localStorage.removeItem(OVERRIDE_KEY)
  } catch {
    // storage unavailable: the flip lasts until reload
  }
}

export function themeAt(now: number): Theme {
  return readOverride(now) ?? daylightAt(now).natural
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#efe6d6' : '#2a2622')
}

/** Flips the theme on screen until the next sunrise or sunset; flipping to what the sun says returns to auto.
 *  ThemeProvider listens for 'storage' (another tab's flip), so the same event tells it about this one. */
export function flipTheme(shown: Theme, now = Date.now()): Theme {
  const { natural, to } = daylightAt(now)
  const next: Theme = shown === 'day' ? 'night' : 'day'
  setOverride(next === natural ? null : next, to)
  window.dispatchEvent(new Event('storage'))
  return next
}
