// Soft clay presses (styles/press.css): marks what a pointer presses with .is-pressed and keeps
// it at least MIN_MS, so a quick tap on a phone still shows the whole press. :active alone ends
// as soon as the finger lifts, often before the press is visible. A scroll that starts on a
// button cancels the pointer, which releases the press too.

const PRESSABLE = 'button, a[href], summary'
const MIN_MS = 120

export function installPress() {
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = (event.target as Element | null)?.closest<HTMLElement>(PRESSABLE)
    if (!target || (target as HTMLButtonElement).disabled) return
    target.classList.add('is-pressed')
    const start = performance.now()
    const release = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.setTimeout(() => target.classList.remove('is-pressed'), Math.max(0, MIN_MS - (performance.now() - start)))
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  })
}
