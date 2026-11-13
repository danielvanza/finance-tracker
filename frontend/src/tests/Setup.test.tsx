import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Setup from '../pages/Setup'
import { SETUP_SECTIONS } from '../pages/setup/sections'

// The sections are other tests' business; here each is a section with its own title.
const stub = vi.hoisted(() => (title: string) => ({
  default: () => <section className="section"><h2>{title}</h2></section>,
}))
vi.mock('../components/BudgetPlanner', () => stub('Budget'))
vi.mock('../pages/Rules', () => stub('Rules'))
vi.mock('../pages/Settings', () => stub('Financial month start day'))
vi.mock('../components/CategoryManager', () => stub('Categories'))
vi.mock('../components/SetAsides', () => stub('Set-asides'))
vi.mock('../components/TargetSplit', () => stub('Target split'))
vi.mock('../components/OwnNames', () => stub('Your own accounts'))
vi.mock('../components/reports/YourData', () => stub('Your data'))

function Where() {
  const { hash } = useLocation()
  return <p data-testid="hash">{hash}</p>
}

const show = (at = '/setup') => render(<MemoryRouter initialEntries={[at]}><Setup /><Where /></MemoryRouter>)

describe('Setup jump row', () => {
  const scrolled: Element[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
  })

  it('has one link per section, in the order the sections sit, and gives each section its id', () => {
    show()
    const links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(SETUP_SECTIONS.map(s => `#${s.id}`))
    const titles = [...document.querySelectorAll('.setup-sections > .section')].map(s => s.querySelector('h2')?.textContent)
    expect(titles).toHaveLength(SETUP_SECTIONS.length)
    SETUP_SECTIONS.forEach((s, i) => expect(document.getElementById(s.id)).toBe(document.querySelectorAll('.setup-sections > .section')[i]))
    expect(document.getElementById('target-split')).toHaveTextContent('Target split')
    expect(document.getElementById('month-start')).toHaveTextContent('Financial month start day')
  })

  it('scrolls to the section a link names and keeps it in the address', () => {
    show()
    fireEvent.click(screen.getByRole('link', { name: 'Target split' }))
    expect(scrolled).toEqual([document.getElementById('target-split')])
    expect(screen.getByTestId('hash')).toHaveTextContent('#target-split')
    fireEvent.click(screen.getByRole('link', { name: 'Target split' }))
    expect(scrolled).toHaveLength(2)
  })

  it('opens on the section named in the address', () => {
    show('/setup#your-data')
    expect(scrolled).toEqual([document.getElementById('your-data')])
  })

  it('opens at the top when the address names nothing here', () => {
    show('/setup#nowhere')
    expect(scrolled).toEqual([])
  })
})
