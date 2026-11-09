/** A calendar date in the app's short form: "6 Nov". Noon keeps the local day whatever the zone. */
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
