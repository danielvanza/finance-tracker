import { test, expect, type Browser, type Page } from '@playwright/test'
import { App, decide, ingCsv, ingRow, lastPending, monthDates, openChat, say, script, shot } from './fixtures'

// The bubble's place and look, with botkit's scripted model making the cards (no Claude needed).
const app = new App({ port: 18781 })
const d = monthDates()
const PAGES = ['/', '/transactions', '/trends', '/setup', '/import']
const PHONE = { width: 390, height: 844 }
const COMPUTER = { width: 1280, height: 900 }
const THEMES = ['day', 'night'] as const

async function open(page: Page, theme: 'day' | 'night', path = '/') {
  await page.addInitScript(([chosen]) => {
    localStorage.setItem('life.theme-override', JSON.stringify({ theme: chosen, until: Date.now() + 86_400_000 }))
  }, [theme])
  await page.goto(app.base + path)
  await expect(page.locator('.chat-fab')).toBeVisible()
}

const phonePage = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  return context.newPage()
}

const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).first().boundingBox()
  if (!rect) throw new Error(`${selector} has no box`)
  return rect
}

const token = (page: Page, name: string) => page.evaluate(n => {
  const probe = document.createElement('div')
  probe.style.color = `var(${n})`
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}, name)

test.describe.serial('the bubble on screen', () => {
  test.beforeAll(async () => {
    await app.start()
    await app.addRule('sample shop', 'Miscellaneous')
    const rows = Array.from({ length: 40 }, (_, i) => ingRow(d.inMonth(i % 15), `Sample Shop ${i}`, -100 - i, String(i)))
    await app.importCsv(ingCsv(rows))
    await app.useRunner('script', 'script')
  })

  test.afterAll(async () => {
    await app.stop()
    app.destroy()
  })

  for (const viewport of [PHONE, COMPUTER]) {
    const name = viewport === PHONE ? 'phone' : 'computer'
    for (const route of PAGES) {
      test(`R-019: ${name} ${route}: 56px clay button, clear of the tabs, last row scrolls clear`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await open(page, 'day', route)
        await page.waitForTimeout(400)
        const fab = await box(page, '.chat-fab')
        expect(fab.width).toBe(56)
        expect(fab.height).toBe(56)
        expect(viewport.width - (fab.x + fab.width)).toBeLessThanOrEqual(40)
        expect(viewport.height - (fab.y + fab.height)).toBeLessThanOrEqual(90)
        if (viewport === PHONE) {
          const tabs = await box(page, '.tabbar')
          expect(fab.y + fab.height).toBeLessThanOrEqual(tabs.y - 4)
        }
        const colour = await page.locator('.chat-fab').evaluate(el => getComputedStyle(el).backgroundColor)
        expect(colour).not.toBe(await token(page, '--shu'))
        expect(colour).toBe(await token(page, '--raised'))
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(150)
        const lastBottom = await page.locator('main.content').evaluate(main => {
          const style = getComputedStyle(main)
          return main.getBoundingClientRect().bottom - parseFloat(style.paddingBottom)
        })
        expect(lastBottom).toBeLessThanOrEqual(fab.y + 0.5)
      })
    }
  }

  test('R-020: a computer panel sits beside a usable, undimmed page, and Apply updates it', async ({ page }) => {
    await page.setViewportSize(COMPUTER)
    await open(page, 'day')
    let loads = 0
    page.on('load', () => loads++)
    const contentBefore = await box(page, 'main.content')
    await openChat(page)
    await page.waitForTimeout(300)
    const panel = await box(page, 'dialog.chat-dialog')
    expect(panel.width).toBe(400)
    expect(panel.x + panel.width).toBeGreaterThanOrEqual(COMPUTER.width - 15) // the page scrollbar keeps its gutter
    expect(panel.height).toBe(COMPUTER.height)
    const content = await box(page, 'main.content')
    expect(content.x + content.width).toBeLessThanOrEqual(panel.x + 1)
    expect(content.width).toBeLessThan(contentBefore.width)
    expect(await page.locator('dialog.chat-dialog').evaluate(el => el.matches(':modal'))).toBe(false)

    await shot(page, 'panel-desktop-day')
    const figures = page.locator('main.content h1')
    const before = await figures.innerText()
    await say(page, script(['make_change', {
      kind: 'transaction.add', summary: 'Add a large sample payment.',
      args: { date: d.today, amount_cents: -50_000, description: 'Sample Big Payment', category_id: (await app.category('Miscellaneous')).id },
    }], 'SCRIPT-SAY Added as a manual entry.'))
    const card = lastPending(page)
    await expect(card).toBeVisible()
    await decide(page, card, 'Apply')
    await expect(figures).not.toHaveText(before)
    expect(loads).toBe(0)

    // Still usable while open: a tab works and the panel stays.
    await page.getByRole('link', { name: 'Trends' }).click()
    await expect(page).toHaveURL(/trends/)
    await expect(page.locator('dialog.chat-dialog')).toBeVisible()
    await app.post('/chat/new', { channel: 'bubble' })
  })

  for (const [route, width] of PAGES.flatMap(r => [1024, 1100, 1280].map(w => [r, w] as const))) {
    test(`R-020: ${route} stays usable beside the open panel at ${width}px`, async ({ page }) => {
      // Known before bot-kit: on main too, Setup's NEEDS/WANTS/SAVINGS run past the page beside the panel at 1100px.
      test.fixme(route === '/setup' && width === 1100, 'Setup overflows beside the panel at 1100px, on main as well')
      await page.setViewportSize({ width, height: COMPUTER.height })
      await open(page, 'night', route)
      await openChat(page)
      await page.waitForTimeout(350)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      const squeezed = await page.locator('main.content').evaluate(main =>
        [...main.querySelectorAll<HTMLElement>('button, a, h1, h2, h3, span, dt, td, th')]
          .filter(el => el.offsetParent !== null && el.innerText?.trim().length >= 4 && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 22 && !el.closest('svg'))
          .map(el => el.innerText.slice(0, 20)))
      expect(squeezed).toEqual([])
      // Anything wider than the page must scroll inside its own card, never run under the panel.
      const spilling = await page.locator('main.content').evaluate(main => {
        const right = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight)
        const scrolls = (el: Element) => {
          for (let up = el.parentElement; up && up !== main; up = up.parentElement) {
            if (getComputedStyle(up).overflowX === 'auto') return true
          }
          return false
        }
        return [...main.querySelectorAll<HTMLElement>('table, th, td, .panel, button, input, select, a')]
          .filter(el => el.offsetParent !== null && !scrolls(el) && el.getBoundingClientRect().right > right + 1)
          .map(el => el.tagName + ':' + el.innerText?.slice(0, 20))
      })
      expect(spilling).toEqual([])
      await shot(page, `docked-${width}${route.replace('/', '-')}`)
    })
  }

  for (const [name, viewport] of [['phone', PHONE], ['computer', COMPUTER]] as const) {
    test(`R-030: ${name}: in a long conversation the message box is whole and covers nothing`, async ({ browser }) => {
      const page = viewport === PHONE ? await phonePage(browser) : await browser.newPage({ viewport })
      await open(page, 'day')
      await openChat(page)
      await app.post('/chat/new', { channel: 'bubble' })
      for (let i = 0; i < 8; i++) {
        await say(page, `Question ${i}\nSCRIPT-SAY Answer ${i}\nSCRIPT-SAY \nSCRIPT-SAY With a second paragraph to fill the thread.`)
        await expect(page.locator('.bk-reply', { hasText: `Answer ${i}` })).toBeVisible()
      }
      await page.waitForTimeout(300)
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        return { box: rect('.bk-foot textarea'), body: rect('.bk-body'), foot: rect('.bk-foot'), dialog: rect('dialog.chat-dialog'), height: innerHeight }
      })
      expect(geometry.box.height).toBeGreaterThanOrEqual(44)
      expect(geometry.box.bottom).toBeLessThanOrEqual(Math.min(geometry.dialog.bottom, geometry.height))
      expect(geometry.foot.bottom).toBeLessThanOrEqual(geometry.dialog.bottom + 0.5)
      expect(geometry.body.bottom).toBeLessThanOrEqual(geometry.foot.top + 0.5)
      await shot(page, `long-thread-${name}`)
      await app.post('/chat/new', { channel: 'bubble' })
      await page.close()
    })
  }

  test('R-021: a phone sheet covers the tabs, closes with Close and nothing runs off at 390px', async ({ browser }) => {
    const page = await phonePage(browser)
    await open(page, 'day')
    await openChat(page)
    await page.waitForTimeout(300)
    const sheet = await box(page, 'dialog.chat-dialog')
    expect(sheet.x).toBe(0)
    expect(sheet.width).toBe(390)
    expect(sheet.y + sheet.height).toBe(PHONE.height)
    expect(await page.locator('dialog.chat-dialog').evaluate(el => el.matches(':modal'))).toBe(true)
    const covering = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('dialog') !== null, [195, PHONE.height - 20])
    expect(covering).toBe(true)

    const long = 'Sample Extraordinarily Long Unbroken Merchant Name With Worldwide Shipping Limited'
    await say(page, script(['make_change', {
      kind: 'transaction.add', summary: `Add ${long}.`, note: 'A long note about a payment that was not found in the bank file yet, so a manual entry is proposed instead.',
      args: { date: d.today, amount_cents: -123_456, description: long, category_id: (await app.category('Recreation & Entertainment')).id },
    }], 'SCRIPT-SAY Sample words to go with it.'))
    await expect(lastPending(page)).toBeVisible()
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      dialog: document.querySelector('dialog')!.scrollWidth,
    }))
    expect(overflow.page).toBeLessThanOrEqual(390)
    expect(overflow.dialog).toBeLessThanOrEqual(390)
    await shot(page, 'sheet-phone-day')

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('dialog.chat-dialog')).toBeHidden()
    await expect(page.locator('.chat-fab')).toBeVisible()
    await app.post('/chat/new', { channel: 'bubble' })
    await page.close()
  })

  test('R-027: an empty chat explains itself and offers starters, the review one only when something waits', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await open(page, 'day')
    await openChat(page)
    await expect(page.locator('.bk-intro')).toContainText('nothing changes until it is applied')
    await expect(page.locator('.bk-starters .bk-btn')).toHaveCount(2)
    await expect(page.locator('.bk-starters')).not.toContainText('to review')
    await shot(page, 'first-open-phone-empty')

    // Three payments waiting for an answer (made so directly: how they come to wait is not this check's business).
    await app.importCsv(ingCsv([
      ingRow(d.inMonth(1), 'Sample Shop Guess One', -300), ingRow(d.inMonth(2), 'Sample Shop Guess Two', -400), ingRow(d.inMonth(3), 'Sample Shop Guess Three', -500),
    ]))
    app.sql("UPDATE transactions SET confirmed = 0 WHERE description LIKE 'Sample Shop Guess%'")
    await page.reload()
    await openChat(page)
    await expect(page.locator('.bk-starters .bk-btn')).toHaveCount(3)
    await expect(page.locator('.bk-starters')).toContainText('Go through the 3 to review')
    await shot(page, 'first-open-phone-review')
  })

  for (const theme of THEMES) {
    test(`R-030: ${theme}: clay tokens and 44px controls on a phone`, async ({ browser }) => {
      const page = await phonePage(browser)
      await open(page, theme)
      await openChat(page)
      await app.post('/chat/new', { channel: 'bubble' })
      await say(page, script(['show_choices', { ids: (await app.transactions()).slice(0, 2).map(t => t.id) }], 'SCRIPT-SAY Which one?'))
      await expect(page.locator('.bk-options .bk-btn').first()).toBeVisible()
      await say(page, script(['make_change', {
        kind: 'transaction.add', summary: 'Add it.',
        args: { date: d.today, amount_cents: -100, description: 'Sample Theme', category_id: (await app.category('Clothing')).id },
      }], 'SCRIPT-SAY Added.'))
      await expect(lastPending(page)).toBeVisible()
      await page.getByRole('button', { name: 'New chat', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Start new chat' })).toBeVisible()

      const small = await page.locator('dialog.chat-dialog').evaluate(dialog =>
        [...dialog.querySelectorAll<HTMLElement>('button, textarea, input:not([type=file])')]
          .map(el => ({ text: el.innerText || el.getAttribute('aria-label') || el.tagName, height: el.getBoundingClientRect().height }))
          .filter(el => el.height < 44))
      expect(small).toEqual([])

      const dialogBg = await page.locator('dialog.chat-dialog').evaluate(el => getComputedStyle(el).backgroundColor)
      expect(dialogBg).toBe(await token(page, '--card'))
      const inkColour = await page.locator('.bk-title').evaluate(el => getComputedStyle(el).color)
      expect(inkColour).toBe(await token(page, '--ink'))
      await shot(page, `sheet-phone-${theme}`)
      await page.getByRole('button', { name: 'Close' }).click()
      await page.close()
      const desktop = await browser.newPage({ viewport: COMPUTER })
      await open(desktop, theme)
      await openChat(desktop)
      await desktop.waitForTimeout(250)
      await shot(desktop, `panel-desktop-${theme}`)
      await desktop.close()
    })
  }
})
