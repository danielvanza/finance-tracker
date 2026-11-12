export const SOURCES = ['ing']
export const BANKS: Record<string, string> = { ing: 'ING' }

const readHead = (file: File) =>
  new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => resolve('')
    reader.readAsText(file.slice(0, 600))
  })

/** Whether a file's header line is that of an ING export, in English or Dutch. Only used to explain an empty preview. */
export async function looksLikeIng(file: File): Promise<boolean> {
  const head = (await readHead(file)).split(/\r?\n/, 1)[0].toLowerCase()
  return head.includes('name / description') || head.includes('naam / omschrijving')
}
