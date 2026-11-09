export const SOURCES = ['ing', 'revolut', 'degiro']
export const BANKS: Record<string, string> = { ing: 'ING', revolut: 'Revolut', degiro: 'DEGIRO' }

const readHead = (file: File) =>
  new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => resolve('')
    reader.readAsText(file.slice(0, 600))
  })

/** Which bank a file's header line belongs to, or null when it matches none of them. Only used to explain an empty preview. */
export async function sniffBank(file: File): Promise<string | null> {
  const head = (await readHead(file)).split(/\r?\n/, 1)[0]
  if (head.includes('Started Date')) return 'revolut'
  if (head.includes(';') && head.includes('Name / Description')) return 'ing'
  if (head.includes('Product') && head.includes('Change')) return 'degiro'
  return null
}
