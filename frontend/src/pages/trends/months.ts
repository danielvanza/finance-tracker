export const monthName = (label: string, month: 'short' | 'long') =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month })

/** "August", "August and September", "June, July and August". */
export function nameList(labels: string[]) {
  const names = labels.map(l => monthName(l, 'long'))
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
