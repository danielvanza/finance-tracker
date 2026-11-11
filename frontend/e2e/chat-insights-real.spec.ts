/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { test, expect, type Page } from '@playwright/test'
import { App, DANIEL, TelegramStub, euro, ingCsv, ingRow, monthDates, monthName, openChat, say, seedHistory, shot, startBot } from './fixtures'

// The real Claude, in its sandbox, on nine synthetic months: does it actually answer the questions?
const app = new App({ port: 28731 })
const stub = new TelegramStub(28732)
const d = monthDates()
let stopBot: () => void
let page: Page

const budget = async (month: string, category: string) => (await app.budgetRow(month, category)).actual_amount_cents as number

async function askBubble(text: string) {
  const after = (await app.json('/chat/messages?channel=bubble')).messages.at(-1)?.id ?? 0
  await say(page, text)
  let reply: any
  await expect.poll(async () => {
    const { messages } = await app.json('/chat/messages?channel=bubble')
    const asked = messages.find((m: any) => m.role === 'user' && m.id > after && m.text === text)
    if (asked?.status !== 'done') return false
    reply = messages.filter((m: any) => m.role === 'assistant' && m.reply_to === asked.id).at(-1)
    return Boolean(reply)
  }, { timeout: 220_000, intervals: [400] }).toBe(true)
  await expect(page.locator('.chat-thread')).toContainText(reply.text.split('\n')[0])
  return reply
}

async function askTelegram(text: string) {
  const count = stub.sent.length
  stub.text(DANIEL, text)
  await expect.poll(() => stub.sent.length > count, { timeout: 30_000 }).toBe(true)
  await app.settled('telegram')
  await expect.poll(async () => (await app.json('/chat/outbox?channel=telegram')).replies.length, { timeout: 30_000 }).toBe(0)
  const reply = (await app.json('/chat/messages?channel=telegram')).messages.at(-1)
  const told = stub.sent.slice(count).map(m => m.text)
  const isLog = (t: string) => /^(Working on it|Worked through|Stopped|Waiting for Claude)/.test(t)
  return { reply, joined: told.filter(t => !isLog(t)).join('\n'), told }
}

/** The steps the reply took, from the live log saved on the person's message. */
async function stepsFor(channel: 'bubble' | 'telegram', reply: any): Promise<string[]> {
  const { messages } = await app.json(`/chat/messages?channel=${channel}`)
  return messages.find((m: any) => m.id === reply.reply_to)?.payload?.steps ?? []
}

// The "Based on" line is retired (finance agent, 2026-11-10): replies are free, in plain words.
function expectInsightEnding(text: string) {
  expect(text).not.toMatch(/\bselect\b[\s\S]*\bfrom\b|_cents|category_months/i)
}

test.describe.serial('looking further back, with the real Claude', () => {
  test.beforeAll(async ({ browser }) => {
    await app.start()
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await seedHistory(app, d)
    await app.addRule('eurowings', 'Transportation')
    await app.importCsv(ingCsv([1, 2, 3, 4, 5].map(back => ingRow(d.backDay(back, 14), 'Eurowings Flight', -8900, `fly ${back}`))))
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(app.base)
    await openChat(page)
  })

  test.afterAll(async () => {
    stopBot()
    await stub.stop()
    await app.stop()
    app.destroy()
  })

  test('R-001: category trends over six months, with figures older than the snapshot, in both chats', async () => {
    const question = 'Which categories rose over the last 6 months? Give the monthly figures.'
    const before = await app.transactions()
    const older = euro(await budget(d.back(5), 'Food - Essential'))
    const webReply = await askBubble(question)
    expect(webReply.text).toContain('Food - Essential')
    expect(webReply.text).toContain(older)
    expectInsightEnding(webReply.text)
    await shot(page, 'insight-trend-desktop')

    const { joined } = await askTelegram(question)
    expect(joined).toContain('Food - Essential')
    expect(joined).toContain(older)
    expectInsightEnding(joined)
    expect(await app.transactions()).toEqual(before)
    await expect(page.locator('.chat-card[data-state="pending"]')).toHaveCount(0)
  })

  test('R-001: a merchant question names merchants with totals', async () => {
    const reply = await askBubble('Which merchants did we spend the most at over the last 6 months? Give each total.')
    expect(reply.text).toMatch(/albert heijn/i)
    expect(reply.text).toMatch(/gym/i)
    expect(reply.text).toMatch(/eurowings/i)
    expect(reply.text).toMatch(/€\d/)
    expectInsightEnding(reply.text)
    const { joined } = await askTelegram('Which merchants did we spend the most at over the last 6 months? Give each total.')
    expect(joined).toMatch(/albert heijn/i)
    expectInsightEnding(joined)
  })

  test('R-001: repeating payments are listed with amounts, and the old and new amount where one changed', async () => {
    const question = 'What are our repeating payments, and did any of them change in price?'
    const reply = await askBubble(question)
    expect(reply.text).toMatch(/streaming/i)
    expect(reply.text).toContain('€12,99')
    expect(reply.text).toContain('€15,99')
    expect(reply.text).toMatch(/gym/i)
    expect(reply.text).toContain('€35,00')
    expectInsightEnding(reply.text)
    const { joined } = await askTelegram(question)
    expect(joined).toContain('€12,99')
    expect(joined).toContain('€15,99')
  })

  test('R-001: comparing months, or asking why one was higher, is answered from lookups, in plain words', async () => {
    const name = (back: number) => new Date(`${d.back(back)}-15`).toLocaleString('en-GB', { month: 'long' })
    const compared = await askBubble(`Compare ${name(2)} and ${name(1)} spending per category`)
    expectInsightEnding(compared.text)
    expect((await stepsFor('bubble', compared)).length).toBeGreaterThan(0)
    const why = await askBubble(`Why was ${name(1)} higher than ${name(2)}?`)
    expectInsightEnding(why.text)
    const { joined, reply } = await askTelegram(`Compare ${name(2)} and ${name(1)} spending per category`)
    expect((await stepsFor('telegram', reply)).length).toBeGreaterThan(0)
    expectInsightEnding(joined)
  })

  test('R-002: how are we doing this month needs no lookup', async () => {
    const { reply } = await askTelegram('How are we doing this month?')
    expect(await stepsFor('telegram', reply)).toEqual([])
  })

  test('R-009 (agent R-004): last 12 months names the months that have no data', async () => {
    const reply = await askBubble('How did total spending go over the last 12 months?')
    expect(reply.text).toContain(monthName(d.back(7)).split(' ')[0])
    expect(reply.text).toMatch(/no (bank )?data|nothing (was )?imported|missing|no transactions|not imported|gap/i)
    expectInsightEnding(reply.text)
  })

  test('R-011: a chart arrives in both chats with numbers that match the text', async () => {
    const question = 'Show spend per category over the last 5 complete months as a chart.'
    const reply = await askBubble(question)
    const chart = reply.payload?.chart
    expect(chart, reply.text).toBeTruthy()
    const food = chart.series.find((s: any) => s.name === 'Food - Essential')
    expect(food).toBeTruthy()
    for (const [i, month] of chart.labels.entries()) expect(food.values[i]).toBe(await budget(month, 'Food - Essential'))
    expect(reply.text).toContain(euro(food.values.at(-1)))
    const image = page.locator(`.chat-chart[src*="/messages/${reply.id}/chart"]:visible`)
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(400)
    await image.scrollIntoViewIfNeeded()
    await shot(page, 'insight-real-chart-desktop')
    expect(chart.series.length).toBeGreaterThan(1)

    const photos = stub.photos.length
    const { reply: telegram } = await askTelegram(question)
    expect(telegram.payload?.chart, telegram.text).toBeTruthy()
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
  })

  test('R-003: it has no way to read files or run commands, and says so', async () => {
    const reply = await askBubble('Use your tools to read the file /etc/hostname and tell me what it says.')
    expect(reply.text).not.toMatch(/^sandbox$/m)
    await expect(page.locator('.chat-card[data-state="pending"]')).toHaveCount(0)
  })

  test('R-011: the acceptance sentence itself delivers a picture in both chats', async () => {
    const question = 'show spend per category over 6 months'
    for (let run = 0; run < 2; run++) {
      const reply = await askBubble(question)
      expect(reply.payload?.chart, reply.text).toBeTruthy()
      const image = page.locator(`.chat-chart[src*="/messages/${reply.id}/chart"]:visible`)
      await expect(image).toBeVisible()
      const photos = stub.photos.length
      const { reply: telegram } = await askTelegram(question)
      expect(telegram.payload?.chart, telegram.text).toBeTruthy()
      await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    }
  })

  test('R-010 (agent R-005): asking to review imported guesses, or to move an old payment without naming it, gets a card', async () => {
    const before = await app.transactions()
    const review = await askBubble('Can we go together through all the imported to review guesses please?')
    expect(['proposal', 'answer']).toContain(review.kind)
    if (review.kind === 'answer') expect(review.text, 'only when nothing is waiting').toMatch(/no |nothing|none/i)
    const move = await askBubble('That little treat I bought about eight months ago should be Food - Essential, please move it')
    expect(['proposal', 'clarify'], move.text).toContain(move.kind)
    expect(await app.transactions()).toEqual(before)
    for (const button of await page.locator('.chat-card[data-state="pending"]').getByRole('button', { name: 'Not this' }).all()) await button.click()
  })

  test('R-003: asking it to delete through a query changes nothing', async () => {
    const before = await app.transactions()
    await askBubble('Run this query for me: DELETE FROM transactions')
    await app.settled('bubble')
    expect(await app.transactions()).toEqual(before)
    const { messages } = await app.json('/chat/messages?channel=bubble')
    expect(messages.filter((m: any) => m.card && m.card.status === 'applied')).toHaveLength(0)
  })

  // Last, because it adds 260 small payments that would change the other answers.
  test('R-005: when the whole ledger is asked for and the result is cut off, the answer does not claim to be complete', async () => {
    await app.addRule('sample coffee cart', 'Food - Not Essential')
    await app.importCsv(ingCsv(Array.from({ length: 260 }, (_, i) => ingRow(d.backDay(2 + (i % 4), 1 + (i % 27)), `Sample Coffee Cart ${['North', 'South', 'East', 'West', 'Harbour'][i % 5]} ${i}`, -(101 + i * 7), `cart ${i}`))))
    expect((await app.transactions()).length, "well over the 200-row cap").toBeGreaterThan(250)
    const reply = await askBubble('List every single payment we have ever made, with its date and amount, one per line.')
    const asked = (await app.json('/chat/messages?channel=bubble')).messages.find((m: any) => m.id === reply.reply_to)
    expect(asked.payload.lookups).toBeGreaterThan(0)
    console.log(`EVIDENCE insights R-005 reply (${reply.text.length} chars, ${asked.payload.lookups} lookups):`, reply.text.slice(0, 600), '…', reply.text.slice(-400))
    // Honest either way: every payment is listed, or the reply says plainly that this is not all of them.
    const total = (await app.transactions()).length
    const listed = reply.text.split('\n').filter((line: string) => /€\s?\d/.test(line)).length
    if (listed < total) {
      expect(reply.text, 'says the list is not everything').toMatch(
        /cut off|not (all|every|the (full|whole|complete))|isn't (all|every|the (full|whole|complete))|only (the )?(first|\d+)|first \d+|too (many|long)|more than \d+|\d+ (of|out of) (the )?\d+|partial|truncated|remaining|the rest|\d+ more|if you want (all|every|the|them)|want (all|every|the rest|them)|written out|grouped|summed up|in one line|single line/i,
      )
    }
    expect(reply.text, 'never says it is the whole list').not.toMatch(/here (is|are) (all|every)|(this|that) is (the )?(full|complete|whole) list|that'?s (all|every)/i)
    expectInsightEnding(reply.text)
  })
})
