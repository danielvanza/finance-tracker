/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, GROUP, PARTNER, STRANGER, TelegramStub, euro, ingCsv, ingRow, openChat, port, repo, say, script, shot, startBot,
} from './fixtures'

// "Just works for two" (thoughts/features/2026-11-11-just-works-for-two) in controlled conditions: the real
// app, Telegram bot (bot-kit's Telegram front) and browser, with botkit's scripted model answering in both chats
// (SCRIPT-* lines in the message), a scripted sorter for imports, and the app's clock held still.
// What rests on Claude's own judgement (reading a receipt, a card from a voice note, which guesses are sure)
// is in just-works-real. The upgrade of an existing database and the unasked messages are in just-works-upgrade.
const NOW = '2026-11-15T12:00' // a Sunday; the financial month runs 24 Oct to 23 Nov
const TODAY = '2026-11-15'
const MONTH = '2026-11'
const app = new App({ port: port(0), fakeClaude: true })
const stub = new TelegramStub(port(1))
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
let stopBot: () => void
let page: Page

/** What a person types, with the scripted model's answer to it. */
const answer = (words: string, text: string) => `${words}\nSCRIPT-SAY ${text}`
/** What a person types, and the card the scripted model makes for it (with its words on the card, if any). */
const propose = (words: string, summary: string, kind: string, args: object, text = '') =>
  `${words}\n${script(['make_change', { kind, summary, args }], `SCRIPT-SAY ${text}`)}`
const sure = (index: number, category: string) => ({ index, category, sure: true })
const unsure = (index: number, category: string, options: string[] = []) => ({ index, category, sure: false, options })
/** What the scripted Claude answers when the app asks it to sort imported rows. */
const sortsAs = (items: object[]) => app.fake({ plain: JSON.stringify(items) })
const idOf = async (name: string) => (await app.category(name)).id
const telegram = async () => (await app.conversation('telegram')).messages
const pace = () => app.json<any>('/dashboard/pace')
const rows = async (prefix: string) => (await app.transactions()).filter(t => t.description.startsWith(prefix))
const isCard = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Apply')
const isQuestion = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Something else')
const labels = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.text)
const wholeEuro = (cents: number) => `€${Math.floor((Math.abs(cents) + 50) / 100).toString().replace(/\B(?=(\d{3})+$)/g, '.')}`
const contextOf = (prompt: string) => JSON.parse(prompt.split('<context>\n')[1].split('\n</context>')[0])
const conversationOf = (prompt: string) => JSON.parse(prompt.split('<conversation>\n')[1].split('\n</conversation>')[0])
const newMessageOf = (prompt: string) => JSON.parse(prompt.split('<new_message>\n')[1].split('\n</new_message>')[0])

/** Opens a category's row on the Month page; one with nothing spent sits in its group's folded "untouched" list. */
async function openCategory(name: string) {
  await page.locator('section.cat-group').first().waitFor()
  const folded = page.locator('details.untouched:not([open]) > summary')
  while (await folded.count() > 0) await folded.first().click()
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

/** Sends a message ending in SCRIPT-ECHO and returns the whole prompt the model was given for it. */
async function echo(from: number, words: string) {
  const count = stub.sent.length
  stub.text(from, `${words}\nSCRIPT-ECHO`)
  await stub.reply_after(count, m => m.text.includes('<new_message>'))
  await quiet()
  return (await telegram()).filter((m: any) => m.kind === 'answer').at(-1).text as string
}

/** Waits until the bot has really shown the newest card, so a typed yes can mean it. */
async function cardShown() {
  await expect.poll(async () => (await telegram()).filter((m: any) => m.kind === 'card').at(-1)?.delivered?.length ?? 0,
    { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0)
}

/** Waits until the bot has shown everything the app has for the group and nothing is being worked on. */
async function quiet() {
  await expect.poll(async () => {
    const box = await app.json<any>('/chat/outbox?channel=telegram')
    return box.replies.length + box.edits.length + box.in_flight.length
  }, { timeout: 60_000, intervals: [300] }).toBe(0)
  await new Promise(resolve => setTimeout(resolve, 1300)) // one more round of the bot, for logs it takes away
}

/** What the group shows of everything sent since `count`. */
const showingSince = (count: number) => stub.sent.slice(count).filter(m => !m.deleted && m.chat_id === GROUP)

async function importInTelegram(from: number, csv: string) {
  const count = stub.sent.length
  stub.document(from, 'export.csv', csv)
  const summary = await stub.reply_after(count, m => m.text.startsWith('ING import') || m.text.startsWith('That file'))
  await quiet()
  return { summary, count }
}

/** Waiting payments put straight into the database, as rows Claude was not sure of. */
function addWaiting(specs: { description: string; cents: number; category: number; date?: string }[]) {
  const values = specs.map((s, i) =>
    `('${s.date ?? '2026-09-05'}', ${s.cents}/100.0, '${s.description}', 'ing', ${s.category}, 0, 'ai', 0.5, '${s.description}-${i}-${Math.random()}', 0, '[]')`)
  app.sql(`INSERT INTO transactions (date, amount, description, source, category_id, confirmed, categorised_by, ai_confidence, import_hash, is_refund, ai_options) VALUES ${values.join(',')}`)
}

const DUTCH_HEADER = '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"'
function dutchRow(date: string, description: string, cents: number, note = '') {
  const amount = (Math.abs(cents) / 100).toFixed(2).replace('.', ',')
  return `"${date.replaceAll('-', '')}";"${description}";"NL57INGB0000000000";"";"BA";"${cents < 0 ? 'Af' : 'Bij'}";"${amount}";"Betaalautomaat";"${note}";"";""`
}
const dutchCsv = (lines: string[]) => [DUTCH_HEADER, ...lines].join('\n') + '\n'

test.describe.serial('just works for two, in controlled conditions', () => {
  test.beforeAll(async ({ browser }) => {
    app.clock(NOW)
    await app.start()
    await app.useRunner('script', 'script', 'bubble')
    await app.useRunner('script', 'script', 'telegram')
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await app.addRule('salaris voorbeeld', 'Salary')
    await app.addRule('sample rent', 'Taxes & Mortgage')
    await app.addRule('sample energy', 'Utilities')
    await app.addRule('albert heijn', 'Food - Essential')
    // Three months of history: pay on the 24th, rent on the 1st (paid this month), energy on the 20th (still to come).
    await app.importCsv(ingCsv([
      ...['2026-08-24', '2026-09-24', '2026-10-24'].map((day, i) => ingRow(day, 'Salaris Voorbeeld BV', 300000, `pay ${i}`)),
      ...['2026-09-01', '2026-10-01', '2026-11-01'].map((day, i) => ingRow(day, 'Sample Rent Housing', -120000, `rent ${i}`)),
      ...['2026-08-20', '2026-09-20', '2026-10-20'].map((day, i) => ingRow(day, 'Sample Energy NV', -14500, `energy ${i}`)),
      ...['2026-10-26', '2026-11-03', '2026-11-10', '2026-11-14'].map((day, i) => ingRow(day, 'Albert Heijn 1234', -5000, `ah ${i}`)),
    ]))
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.clock.setFixedTime(new Date(`${NOW}:00`))
    await page.goto(app.base)
  })

  test.afterAll(async () => {
    stopBot()
    await stub.stop()
    await app.stop()
    app.destroy()
  })

  test.beforeEach(async () => {
    app.fake({ mode: 'reply', delay: '0', plain: '[]' })
    await app.newChats()
    await quiet()
  })

  test('R-001: the bot works in one group for both people, either can press the other\'s card, and nobody else gets anything', async () => {
    let count = stub.sent.length
    stub.text(DANIEL, answer('How are we doing?', 'Hello both.'))
    await stub.reply_after(count, m => m.text === 'Hello both.' && m.chat_id === GROUP)
    await quiet()
    count = stub.sent.length
    stub.text(PARTNER, answer('And when I ask?', 'Hello both.'))
    await stub.reply_after(count, m => m.text === 'Hello both.' && m.chat_id === GROUP)
    expect((await telegram()).filter((m: any) => m.role === 'user').map((m: any) => m.text.split('\n')[0])).toEqual(['How are we doing?', 'And when I ask?'])

    // A card made in answer to one of them is applied by the other.
    const food = await idOf('Food - Essential')
    count = stub.sent.length
    stub.text(DANIEL, propose('I paid 15 at the market', 'Add it.', 'transaction.add', { date: TODAY, amount_cents: -1500, description: 'Sample Shared Card', category_id: food }))
    const card = await stub.reply_after(count, isCard)
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    expect(await rows('Sample Shared Card')).toHaveLength(1)
    // And rejected by the other.
    count = stub.sent.length
    stub.text(PARTNER, propose('and 16 more', 'Add it.', 'transaction.add', { date: TODAY, amount_cents: -1600, description: 'Sample Shared No', category_id: food }))
    const second = await stub.reply_after(count, isCard)
    await cardShown()
    stub.tap(DANIEL, second, stub.button(second, 'Not this'))
    await expect.poll(() => second.text, { timeout: 15_000 }).toContain('Not applied')
    expect(await rows('Sample Shared No')).toHaveLength(0)

    // Any other account, and any other group, gets silence and can press nothing.
    count = stub.sent.length
    stub.text(DANIEL, propose('and 17 more', 'Add it.', 'transaction.add', { date: TODAY, amount_cents: -1700, description: 'Sample Guarded', category_id: food }))
    const guarded = await stub.reply_after(count, isCard)
    await cardShown()
    await quiet()
    count = stub.sent.length
    const saved = (await telegram()).length
    stub.text(STRANGER, 'How much is left?')
    stub.document(STRANGER, 'ing.csv', ingCsv([ingRow('2026-11-12', 'Stranger Row', -100)]))
    stub.text(DANIEL, 'How much is left?', -1009999, 'supergroup')
    stub.text(PARTNER, 'How much is left?', -5559, 'group')
    stub.tap(STRANGER, guarded, stub.button(guarded, 'Apply'))
    stub.tap(DANIEL, guarded, stub.button(guarded, 'Apply'), -1009999)
    await new Promise(resolve => setTimeout(resolve, 3000))
    expect(stub.sent.length, 'nothing was sent anywhere').toBe(count)
    expect((await telegram()).length).toBe(saved)
    expect(await rows('Sample Guarded')).toHaveLength(0)
    expect(await rows('Stranger Row')).toHaveLength(0)
    expect(isCard(guarded)).toBe(true)

    // A private message from either of the two gets one line pointing to the group, and nothing else.
    for (const person of [DANIEL, PARTNER]) {
      count = stub.sent.length
      stub.private(person, 'How are we doing?')
      await expect.poll(() => stub.sent.length, { timeout: 10_000 }).toBe(count + 1)
      expect(stub.sent.at(-1)).toMatchObject({ chat_id: person, text: 'I only work in our shared group. Write to me there.' })
      await new Promise(resolve => setTimeout(resolve, 2000))
      expect(stub.sent.length).toBe(count + 1)
    }
    expect((await telegram()).length, 'a private message is not taken as a question').toBe(saved)
    stub.tap(DANIEL, guarded, stub.button(guarded, 'Not this'))
    await expect.poll(() => guarded.text, { timeout: 15_000 }).toContain('Not applied')
  })

  test('R-002: an answer is one message, a card arrives with its words as one message, and the log is gone once the reply is there', async () => {
    let count = stub.sent.length
    stub.text(DANIEL, script('How are we doing?', 'SCRIPT-SLOW 2', ['month_overview', { doing: 'Checking how this month stands' }], 'SCRIPT-SAY All fine this month.'))
    const log = await stub.reply_after(count, m => m.text.startsWith('Working on it'))
    await expect.poll(() => log.text, { timeout: 10_000 }).toContain('• Checking how this month stands')
    await stub.reply_after(count, m => m.text === 'All fine this month.')
    await quiet()
    expect(log.deleted, 'the log is taken away').toBe(true)
    expect(showingSince(count).map(m => m.text)).toEqual(['All fine this month.'])

    const misc = await idOf('Miscellaneous')
    count = stub.sent.length
    stub.text(PARTNER, script('paid 12,34 for something', 'SCRIPT-SLOW 2',
      ['make_change', { kind: 'transaction.add', summary: 'Add it.', args: { date: TODAY, amount_cents: -1234, description: 'Sample One Message', category_id: misc } }],
      'SCRIPT-SAY I took it to be a general purchase; say if it belongs elsewhere.'))
    const card = await stub.reply_after(count, isCard)
    await quiet()
    const shown = showingSince(count)
    expect(shown, 'the card and its words are one message').toHaveLength(1)
    expect(shown[0]).toBe(card)
    expect(card.text.startsWith('I took it to be a general purchase; say if it belongs elsewhere.')).toBe(true)
    expect(card.text).toContain('Sample One Message')
    expect(stub.sent.slice(count).filter(m => m.deleted).every(m => /^(Working on it|Stopping)/.test(m.edits[0] ?? m.text))).toBe(true)
    stub.tap(DANIEL, card, stub.button(card, 'Not this'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Not applied')
  })

  test('R-003: a simple card is a line or two in plain words in both chats, a batch is summed up in one message, and every row is listed on request', async () => {
    const misc = await idOf('Miscellaneous')
    const before = (await app.budgetRow(MONTH, 'Miscellaneous')).actual_amount_cents
    const simple = (words: string, description: string) => propose(words, 'Add it.', 'transaction.add', { date: TODAY, amount_cents: -1234, description, category_id: misc })
    let count = stub.sent.length
    stub.text(DANIEL, simple('paid 12,34', 'Sample Plain Card'))
    const card = await stub.reply_after(count, isCard)
    expect(card.text.split('\n')).toEqual([
      'Add: Sample Plain Card · 15 Nov · -⁠€12,34, in Miscellaneous',
      `Miscellaneous this month: ${euro(before)} → ${euro(before + 1234)} of €300,00`,
    ])
    expect(labels(card)).toEqual(['Apply', 'Not this'])
    for (const fieldByField of ['Date:', 'Amount:', 'Reviewed', 'Counts as', '—']) expect(card.text).not.toContain(fieldByField)
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\. Add: Sample Plain Card/)
    expect(card.text.split('\n')).toHaveLength(2)
    expect(await rows('Sample Plain Card')).toHaveLength(1)

    // The same card in the app's panel: the same lines, no field list.
    await page.goto(app.base)
    await openChat(page)
    await say(page, simple('paid 12,34 again', 'Sample Plain Panel'))
    const panel = page.locator('.bk-card[data-state="open"]').last()
    await expect(panel.locator('.bk-lines').first().locator('li')).toHaveText(['Add: Sample Plain Panel · 15 Nov · -⁠€12,34, in Miscellaneous'])
    await expect(panel.locator('.hf-effect li')).toHaveCount(1)
    await expect(panel.locator('dl, .hf-all')).toHaveCount(0)
    await shot(page, 'just-works-plain-card')
    await panel.getByRole('button', { name: 'Not this' }).click()
    await expect(page.locator('[data-state="rejected"]').last()).toBeVisible()
    expect(await rows('Sample Plain Panel')).toHaveLength(0)

    // A batch of 120 waiting payments in three categories: summed up per category, in one message.
    const food = await idOf('Food - Essential')
    const eating = await idOf('Food - Not Essential')
    addWaiting([
      ...Array.from({ length: 60 }, (_, i) => ({ description: `Sample Grocer ${i + 1} Enschede`, cents: -1000, category: food })),
      ...Array.from({ length: 40 }, (_, i) => ({ description: `Sample Bistro ${i + 1} Enschede`, cents: -2500, category: eating })),
      ...Array.from({ length: 20 }, (_, i) => ({ description: `Sample Odds ${i + 1} Enschede`, cents: -333, category: misc })),
    ])
    const batch = [...await rows('Sample Grocer'), ...await rows('Sample Bistro'), ...await rows('Sample Odds')]
    expect(batch).toHaveLength(120)
    const confirmAll = (words: string, text = '') => propose(words, 'Confirm these 120.', 'review.confirm', { ids: batch.map(t => t.id) }, text)
    count = stub.sent.length
    stub.text(DANIEL, confirmAll('confirm the lot'))
    const big = await stub.reply_after(count, isCard)
    await quiet()
    expect(showingSince(count), 'one message whatever the size').toHaveLength(1)
    expect(big.text.length).toBeLessThanOrEqual(4096)
    const lines = big.text.split('\n')
    expect(lines[0]).toBe('120 payments')
    expect(big.html.split('\n')[0], 'the count is bold').toBe('<b>120 payments</b>')
    expect(lines).toContain('• Confirm as Food - Essential: 60 payments, €600,00')
    expect(lines).toContain('• Confirm as Food - Not Essential: 40 payments, €1.000,00')
    expect(lines).toContain('• Confirm as Miscellaneous: 20 payments, €66,60')
    expect(big.text, 'the shops are left to Show all').not.toContain('sample grocer')
    expect(lines.length, 'a summary, not a row per payment').toBeLessThan(12)
    expect(big.text).not.toContain('Sample Grocer 17')
    expect(labels(big)).toEqual(['Apply', 'Not this', 'Show all 120 payments'])

    // Asking to see everything lists the rows: by typing it, and by the button. They come grouped by
    // what changes under a bold heading, as columns of date, amount and name that fit a phone.
    count = stub.sent.length
    stub.text(PARTNER, 'Show all')
    const everything = () => stub.sent.slice(count).map(m => m.text).join('\n').split('\n')
    const listed = () => everything().filter(line => /^5 Sep {2,}\d+,\d\d {2}Sample (Grocer|Bistro|Odds) \d+/.test(line))
    await expect.poll(() => listed().length, { timeout: 20_000 }).toBe(120)
    expect(listed()).toContain('5 Sep  10,00  Sample Grocer 17 En…')
    expect(listed().every(line => line.length <= 34), 'no line wraps on a phone').toBe(true)
    for (const heading of ['Confirmed as Food - Essential · 60', 'Confirmed as Food - Not Essential · 40', 'Confirmed as Miscellaneous · 20']) {
      expect(everything()).toContain(heading)
    }
    const html = stub.sent.slice(count).map(m => m.html).join('\n')
    expect(html).toContain('<b>Confirmed as Food - Essential</b> · 60\n<pre>5 Sep  10,00  Sample Grocer ')
    expect(everything().join('\n'), 'confirming remembers no shop by itself').not.toContain('Remembered')
    expect(everything().join('\n')).not.toContain('Reviewed')
    // Listing the rows did not go to the model: the typed words were settled at once, and no reply was worked on.
    const told = await telegram()
    const typed = told.findLast((m: any) => m.role === 'user')
    expect(typed).toMatchObject({ text: 'Show all', status: 'done' })
    expect(told.filter((m: any) => m.id > typed.id).map((m: any) => m.kind)).toEqual(['all_rows'])
    expect((await rows('Sample Grocer')).every(t => !t.confirmed), 'listing changed nothing').toBe(true)
    await quiet()
    count = stub.sent.length
    stub.tap(DANIEL, big, stub.button(big, 'Show all'))
    await expect.poll(() => listed().length, { timeout: 20_000 }).toBe(120)

    await quiet()
    // The same card a second time, while the first is open, is not made.
    // (No closing words, so the reply is the tool's own result: what the model was told.)
    const cardsBefore = app.botValue('SELECT COUNT(*) FROM bot_cards')[0][0]
    count = stub.sent.length
    stub.text(DANIEL, `confirm the lot, I said\n${script(['make_change', { kind: 'review.confirm', summary: 'Confirm these 120.', args: { ids: batch.map(t => t.id) } }])}`)
    const pointed = await stub.reply_after(count, m => m.text.includes('make_change'))
    await quiet()
    expect(isCard(pointed), 'no second card').toBe(false)
    expect(showingSince(count).filter(isCard)).toHaveLength(0)
    expect(pointed.text).toContain('make_change (error)')
    expect(pointed.text).toContain('already open')
    expect(app.botValue('SELECT COUNT(*) FROM bot_cards')[0][0]).toBe(cardsBefore)

    // Not this changes nothing; a new card and Apply confirm all 120.
    stub.tap(DANIEL, big, stub.button(big, 'Not this'))
    await expect.poll(() => big.text, { timeout: 15_000 }).toContain('Not applied')
    expect((await rows('Sample Bistro')).every(t => !t.confirmed)).toBe(true)
    count = stub.sent.length
    stub.text(DANIEL, confirmAll('confirm the lot after all'))
    const again = await stub.reply_after(count, isCard)
    await cardShown()
    stub.tap(PARTNER, again, stub.button(again, 'Apply'))
    await expect.poll(() => again.text, { timeout: 30_000 }).toMatch(/^Applied\./)
    // Once applied it is one sentence and what is left, not the whole summary again.
    expect(again.text.split('\n')[0]).toBe('Applied. 120 payments are now sorted, in 3 categories, €1.666,60 in all.')
    expect(again.html).toMatch(/^<b>Applied\.<\/b> 120 payments/)
    expect(again.text).not.toContain('Confirm as')
    expect(again.text).toMatch(/\n(\d+ payments? still waits?|Nothing is waiting any more)\.$/)
    for (const prefix of ['Sample Grocer', 'Sample Bistro', 'Sample Odds']) expect((await rows(prefix)).every(t => t.confirmed)).toBe(true)
    // R-013: nothing was remembered by itself; the applied card offers it, and one press remembers every shop it sorted.
    const sampleRules = async () => (await app.json<any[]>('/rules')).filter(r => /^sample (grocer|bistro|odds)$/.test(r.pattern)).map(r => `${r.pattern} → ${r.category_name}`).sort()
    expect(await sampleRules()).toEqual([])
    expect(labels(again)).toEqual(['Remember these 3 shops', 'Undo'])
    stub.tap(DANIEL, again, stub.button(again, 'Remember these 3 shops'))
    await expect.poll(() => labels(again), { timeout: 15_000 }).toEqual(['Undo'])
    expect(again.text.split('\n').at(-1)).toBe('Remembered 3 shops for next time.')
    expect(await sampleRules()).toEqual(['sample bistro → Food - Not Essential', 'sample grocer → Food - Essential', 'sample odds → Miscellaneous'])

    // 480 payments from 480 differently named shops in every spending category still fit one message.
    const spending = (await app.json<any[]>('/categories')).filter(c => ['needs', 'wants', 'savings'].includes(c.type))
    addWaiting(Array.from({ length: 480 }, (_, i) => ({
      description: `Wide${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} Longnamedshop Verylongsecondword ${i}`,
      cents: -(100 + i), category: spending[i % spending.length].id,
    })))
    count = stub.sent.length
    stub.text(DANIEL, propose('confirm the wide lot', 'Confirm these 480.', 'review.confirm', { ids: (await rows('Wide')).map(t => t.id) }))
    const wide = await stub.reply_after(count, isCard)
    await quiet()
    expect(showingSince(count)).toHaveLength(1)
    expect(wide.text.length).toBeLessThanOrEqual(4096)
    expect(wide.text.split('\n')[0]).toBe('480 payments')
    await cardShown()
    stub.tap(DANIEL, wide, stub.button(wide, 'Apply'))
    await expect.poll(() => wide.text, { timeout: 60_000 }).toMatch(/^Applied\./)
    expect(wide.text.length).toBeLessThanOrEqual(4096)
    expect((await rows('Wide')).every(t => t.confirmed)).toBe(true)
  })

  test('R-004: a voice note is taken as what was said, the reply shows what was heard, never settles a card, and an unclear note asks to repeat and changes nothing', async () => {
    // A card is open in front of the group.
    const food = await idOf('Food - Essential')
    let count = stub.sent.length
    stub.text(DANIEL, propose('15 cash at the market', 'Add it.', 'transaction.add', { date: TODAY, amount_cents: -1500, description: 'Market (cash)', category_id: food }))
    const card = await stub.reply_after(count, isCard)
    await cardShown()
    await quiet()

    // The voice note is heard on this machine and goes to the model as the person's words (the scripted model,
    // given no SCRIPT lines, says so); the reply starts with what was heard, in one message.
    count = stub.sent.length
    stub.voice(PARTNER, readFileSync(path.join(assets, 'voice-fifteen-euros-market.ogg')))
    const reply = await stub.reply_after(count, m => m.text.startsWith('Heard:') && !m.text.includes('Working on it'))
    await quiet()
    expect(reply.text).toMatch(/^Heard: “(15|fifteen) euros cash at the market\.?”\n\nThe script ran no tools\.$/i)
    expect(showingSince(count), 'one message').toHaveLength(1)
    const saved = (await telegram()).filter((m: any) => m.role === 'user').at(-1)
    expect(saved).toMatchObject({ kind: 'voice' })
    expect(saved.text).toMatch(/^(15|fifteen) euros cash at the market\.?$/i)
    // Replies are text: nothing was sent as sound.
    expect(stub.calls.filter(c => /voice|audio/i.test(c))).toEqual([])
    // Words from a voice note never settle a card: the card is still open, and only a tap applies it.
    expect(isCard(card)).toBe(true)
    expect(app.botValue('SELECT status FROM bot_cards ORDER BY id DESC LIMIT 1')).toEqual([['open']])
    // The model is given what was heard, marked as heard.
    const prompt = await echo(DANIEL, 'what did I say?')
    expect(conversationOf(prompt).find((e: any) => e.heard_from_a_voice_note)).toMatchObject({ from: 'person', text: saved.text })
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    expect(await rows('Market (cash)')).toHaveLength(1)
    await quiet()

    // A note that cannot be made out: asked to repeat or type, nothing changed, the model not asked.
    const before = app.dump()
    const messages = await telegram()
    count = stub.sent.length
    stub.voice(DANIEL, readFileSync(path.join(assets, 'voice-unclear.ogg')))
    const unheard = await stub.reply_after(count, m => !m.text.startsWith('Working on it'))
    expect(unheard.text).toBe('I could not make that out. Could you say it again, or type it? Nothing changed.')
    await quiet()
    expect(showingSince(count)).toHaveLength(1)
    // The note is kept (with no words) and answered with the reason; nothing else was said.
    expect((await telegram()).slice(messages.length).map((m: any) => [m.role, m.kind, m.text])).toEqual([
      ['user', 'voice', ''], ['assistant', 'error', 'I could not make that out. Could you say it again, or type it? Nothing changed.'],
    ])
    expect(app.dump()).toEqual(before)
  })

  test('R-005: a photo is shown to the model, its caption is the person\'s message, an unreadable one is said to be unreadable, and nothing changes without Apply', async () => {
    const eating = await idOf('Food - Not Essential')
    const receipt = readFileSync(path.join(assets, 'receipt-bakery.png'))
    let count = stub.sent.length
    stub.photo(DANIEL, receipt, script(['make_change', { kind: 'transaction.add', summary: 'Add the bakery.', args: { date: '2026-11-11', amount_cents: -780, description: 'Bakkerij De Korenbloem', category_id: eating } }], 'SCRIPT-SAY From the receipt.'))
    const card = await stub.reply_after(count, isCard)
    // The full-size picture was taken, not the thumbnail.
    const photo = (await telegram()).filter((m: any) => m.role === 'user').at(-1)
    expect(photo).toMatchObject({ kind: 'photo', payload: { size: receipt.length } })
    expect(card.text).toContain('Add: Bakkerij De Korenbloem · 11 Nov · -⁠€7,80, in Food - Not Essential')
    expect(await rows('Bakkerij De Korenbloem'), 'nothing changes without Apply').toHaveLength(0)
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    expect(await rows('Bakkerij De Korenbloem')).toHaveLength(1)
    await quiet()

    // A caption is treated as the person's message, marked as coming with a photo.
    count = stub.sent.length
    stub.photo(PARTNER, receipt, 'bakery 7,80 this morning\nSCRIPT-ECHO')
    await stub.reply_after(count, m => m.text.includes('<new_message>'))
    await quiet()
    const echoed = (await telegram()).filter((m: any) => m.kind === 'answer').at(-1).text
    expect(newMessageOf(echoed)).toEqual({ from: 'person', text: 'bakery 7,80 this morning\nSCRIPT-ECHO', sent_a_photo: true })
    expect((await telegram()).filter((m: any) => m.role === 'user').at(-1)).toMatchObject({ kind: 'photo', text: 'bakery 7,80 this morning\nSCRIPT-ECHO' })

    // Something that is not a picture the model can look at: said plainly, nothing changes, the model is not asked.
    const before = app.dump()
    count = stub.sent.length
    stub.photo(DANIEL, Buffer.from('these bytes are not a picture'))
    const refused = await stub.reply_after(count, m => !m.text.startsWith('Working on it'))
    expect(refused.text).toBe('I could not read that picture. Send it as a photo, or type what it shows. Nothing changed.')
    await quiet()
    expect((await telegram()).at(-1)).toMatchObject({ role: 'assistant', kind: 'error' })
    expect(app.dump()).toEqual(before)

    // When the model itself cannot read the photo, its plain words go out and nothing changes.
    count = stub.sent.length
    stub.photo(DANIEL, receipt, 'SCRIPT-SAY I cannot read that photo. Could you type what it shows?')
    await stub.reply_after(count, m => m.text === 'I cannot read that photo. Could you type what it shows?')
    await quiet()
    expect(app.dump()).toEqual(before)

    // Something the bot cannot read at all gets one line saying what it can.
    count = stub.sent.length
    stub.other(PARTNER, 'sticker')
    expect((await stub.reply_after(count, () => true)).text).toBe('I can read text, voice notes, photos and ING exports. Say what happened in one of those.')
  })

  test('R-006: ING exports with Dutch or English columns import alike in Telegram and on the Import page, and any other file gets a sentence', async () => {
    const english = ingCsv([
      ingRow('2026-11-12', 'Albert Heijn 1234', -2340, 'Card sequence no.: 001 12/11/2026 10:00 Transaction: A1 Value date: 12/11/2026'),
      ingRow('2026-11-12', 'Salaris Voorbeeld BV', 5000, 'Name: Salaris Voorbeeld BV Description: bonus Value date: 12/11/2026'),
    ])
    const dutch = dutchCsv([
      dutchRow('2026-11-12', 'Albert Heijn 1234', -2340, 'Pasvolgnr: 001 12-11-2026 10:00 Transactie: A1 Valutadatum: 12-11-2026'),
      dutchRow('2026-11-12', 'Salaris Voorbeeld BV', 5000, 'Naam: Salaris Voorbeeld BV Omschrijving: bonus Valutadatum: 12-11-2026'),
      dutchRow('2026-11-13', 'Albert Heijn 1234', -1111, 'Pasvolgnr: 001 13-11-2026 09:00'),
    ])
    const fromEnglish = await importInTelegram(DANIEL, english)
    expect(fromEnglish.summary.text).toContain('ING import: 2 new payments.')
    const stored = async () => (await app.transactions())
      .filter(t => ['2026-11-12', '2026-11-13'].includes(t.date) && ['Albert Heijn 1234', 'Salaris Voorbeeld BV'].includes(t.description))
      .map(t => ({ date: t.date, description: t.description, amount_cents: t.amount_cents, category: t.category_name, confirmed: t.confirmed, source: t.source }))
      .sort((a, b) => a.amount_cents - b.amount_cents)
    expect(await stored()).toEqual([
      { date: '2026-11-12', description: 'Albert Heijn 1234', amount_cents: -2340, category: 'Food - Essential', confirmed: true, source: 'ing' },
      { date: '2026-11-12', description: 'Salaris Voorbeeld BV', amount_cents: 5000, category: 'Salary', confirmed: true, source: 'ing' },
    ])
    // The same payments from a Dutch export are recognised as already here; the one new row comes in the same way.
    const fromDutch = await importInTelegram(PARTNER, dutch)
    expect(fromDutch.summary.text).toContain('ING import: 1 new payment (2 were here already).')
    expect(await stored()).toEqual([
      { date: '2026-11-12', description: 'Albert Heijn 1234', amount_cents: -2340, category: 'Food - Essential', confirmed: true, source: 'ing' },
      { date: '2026-11-13', description: 'Albert Heijn 1234', amount_cents: -1111, category: 'Food - Essential', confirmed: true, source: 'ing' },
      { date: '2026-11-12', description: 'Salaris Voorbeeld BV', amount_cents: 5000, category: 'Salary', confirmed: true, source: 'ing' },
    ])
    expect((await importInTelegram(DANIEL, dutch)).summary.text).toBe('ING import: nothing new. All 3 payments were here already.')
    expect((await importInTelegram(DANIEL, english)).summary.text).toBe('ING import: nothing new. All 2 payments were here already.')

    // A Dutch file first, then its English twin: the other way round works the same.
    const dutchFirst = dutchCsv([dutchRow('2026-11-13', 'Sample Rent Housing', -999, 'Naam: verhuurder Valutadatum: 13-11-2026')])
    const englishTwin = ingCsv([ingRow('2026-11-13', 'Sample Rent Housing', -999, 'Name: verhuurder Value date: 13/11/2026')])
    // On the Import page.
    await page.goto(`${app.base}/import`)
    await expect(page.getByRole('heading', { name: 'Bring in an ING file' })).toBeVisible()
    await page.locator('#csv-file').setInputFiles({ name: 'NL00INGB_13-11-2026.csv', mimeType: 'text/csv', buffer: Buffer.from(dutchFirst) })
    await page.getByRole('button', { name: 'Preview import' }).click()
    await expect(page.getByRole('heading', { name: '1 new to add' })).toBeVisible()
    await expect(page.locator('.import-table')).toContainText('Sample Rent Housing')
    await expect(page.locator('.import-table')).toContainText('-€9,99')
    await page.getByRole('button', { name: 'Import 1 new transaction' }).click()
    await expect(page.getByText('Added 1 transaction')).toBeVisible()
    const rent = (await rows('Sample Rent Housing')).find(t => t.amount_cents === -999)
    expect(rent).toMatchObject({ date: '2026-11-13', category_name: 'Taxes & Mortgage', confirmed: true, source: 'ing' })
    await page.getByRole('button', { name: 'Import another file' }).click()
    await page.locator('#csv-file').setInputFiles({ name: 'english.csv', mimeType: 'text/csv', buffer: Buffer.from(englishTwin) })
    await page.getByRole('button', { name: 'Preview import' }).click()
    await expect(page.getByRole('heading', { name: 'Nothing new in this file' })).toBeVisible()
    // An older, comma-separated Dutch export reads too.
    const commas = '"Datum","Naam / Omschrijving","Rekening","Tegenrekening","Code","Af Bij","Bedrag (EUR)","MutatieSoort","Mededelingen"\n"20261114","Albert Heijn 1234","NL57INGB0000000000","","BA","Af","7,77","Betaalautomaat","oud formaat"\n'
    expect((await importInTelegram(DANIEL, commas)).summary.text).toContain('ING import: 1 new payment.')
    expect((await rows('Albert Heijn 1234')).filter(t => t.amount_cents === -777 && t.date === '2026-11-14')).toHaveLength(1)

    // Any other file: one sentence saying what is accepted, and nothing is imported.
    const total = (await app.transactions()).length
    const revolut = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-11-02 10:00:00,2026-11-03 10:00:00,Test Cafe,-4.50,0.00,EUR,COMPLETED,100.00\n'
    for (const other of [revolut, '%PDF-1.4 a statement', 'Date,Time,Product,ISIN,Description,FX,Change,,Balance,,Order ID\n01-11-2026,10:00,ETF,IE00,Buy,,EUR,-100.00,EUR,0.00,x\n']) {
      const refused = await importInTelegram(PARTNER, other)
      expect(refused.summary.text).toBe('That file could not be used because it does not have the columns of an ING export. I can only read an ING export: a CSV file from ING, with English or Dutch column names. Nothing was imported.')
    }
    await page.goto(`${app.base}/import`)
    await page.locator('#csv-file').setInputFiles({ name: 'account-statement.csv', mimeType: 'text/csv', buffer: Buffer.from(revolut) })
    await page.getByRole('button', { name: 'Preview import' }).click()
    await expect(page.getByRole('alert')).toContainText('Only an ING export (a CSV file, with English or Dutch column names) can be imported.')
    expect((await app.transactions()).length).toBe(total)
  })

  test('R-011 R-012 R-013: sure guesses count at once, doubtful ones become questions with buttons and count nowhere, and an answer is remembered when asked', async () => {
    const before = await pace()
    const foodBefore = (await app.budgetRow(MONTH, 'Food - Essential')).actual_amount_cents
    const waitingBefore = before.to_review
    sortsAs([
      sure(0, 'Food - Essential'),
      unsure(1, 'Transportation', ['Transportation', 'Food - Not Essential']),
      unsure(2, 'Transportation', ['Transportation', 'Food - Not Essential']),
      unsure(3, 'Miscellaneous', ['Miscellaneous', 'To personal accounts']),
      unsure(4, 'Other Income', ['Other Income', 'Clothing']),
      unsure(5, 'Miscellaneous'),
      unsure(6, 'Miscellaneous'),
    ])
    const { summary, count } = await importInTelegram(PARTNER, ingCsv([
      ingRow('2026-11-12', 'Sample Supermarket 12 Enschede', -2000),
      ingRow('2026-11-12', 'Tango Sample 77 Enschede', -3000),
      ingRow('2026-11-13', 'Tango Sample 78 Enschede', -1000),
      ingRow('2026-11-12', 'Mw P Voorbeeld', -2500),
      ingRow('2026-11-12', 'Sample Webshop', 2000),
      ingRow('2026-11-12', 'Kiosk Onbekend', -300),
      ingRow('2026-11-12', 'Zzz Unknown', -200),
    ]))
    expect(summary.text.split('\n')).toEqual(['ING import: 7 new payments.', '1 sorted and counted, 6 need your answer, which I will ask about here.'])

    // R-011: the sure guess is in the totals with no confirmation, marked as sorted automatically.
    const supermarket = (await rows('Sample Supermarket'))[0]
    expect(supermarket).toMatchObject({ confirmed: true, categorised_by: 'ai', category_name: 'Food - Essential' })
    expect((await app.budgetRow(MONTH, 'Food - Essential')).actual_amount_cents).toBe(foodBefore + 2000)
    // Doubtful ones do not count and wait.
    const after = await pace()
    expect(after.spendable_actual_cents, 'only the sure one counts').toBe(before.spendable_actual_cents + 2000)
    expect(after.to_review).toBe(waitingBefore + 6)
    for (const prefix of ['Tango Sample', 'Mw P Voorbeeld', 'Sample Webshop', 'Kiosk Onbekend', 'Zzz Unknown']) {
      expect((await rows(prefix)).every(t => !t.confirmed), prefix).toBe(true)
    }
    await page.goto(`${app.base}/transactions`)
    const autoRow = page.locator('tr', { hasText: 'Sample Supermarket' }).first()
    await expect(autoRow.locator('.tx-tag', { hasText: 'auto' })).toBeVisible()

    // R-012: the group gets questions, a shop at a time, the largest first, three at once, with buttons for the likely categories.
    const asked = () => showingSince(count).filter(isQuestion)
    await expect.poll(() => asked().length, { timeout: 20_000 }).toBe(3)
    const [tango, person, webshop] = asked()
    expect(tango.text.split('\n')).toEqual(['Tango Sample · 2 payments, €40,00', '13 Nov · -€10,00', '12 Nov · -€30,00', '', 'Where does it belong?'])
    expect(tango.html.split('\n')[0], 'who was paid is bold').toBe('<b>Tango Sample</b> · 2 payments, €40,00')
    expect(labels(tango)).toEqual(['Transportation', 'Food - Not Essential', 'Something else'])
    expect(person.text).toBe('Mw P Voorbeeld · 12 Nov · -€25,00\n\nWhere does it belong?')
    expect(labels(person)).toEqual(['Miscellaneous', 'To personal accounts', 'Something else'])
    expect(webshop.text).toBe('Sample Webshop · 12 Nov · +€20,00\n\nWhat was this money for?')
    expect(labels(webshop)).toEqual(['Other Income', 'Refund: Clothing', 'Something else'])
    // The same payments are in the app's review list.
    // (With payments waiting the page opens its review queue, whose header gives the count.)
    await expect(page.locator('.tx-page')).toContainText(`${waitingBefore + 6} left`)
    const inReview = new Set<string>()
    for (let i = 0, skip: number[] = []; i < 12; i++) {
      const next = await app.json<any>(`/transactions/review?${skip.map(id => `skip_ids=${id}`).join('&')}`)
      if (!next) break
      inReview.add(next.description)
      skip.push(next.id)
    }
    for (const waiting of ['Tango Sample 77 Enschede', 'Tango Sample 78 Enschede', 'Mw P Voorbeeld', 'Sample Webshop', 'Kiosk Onbekend', 'Zzz Unknown']) expect(inReview.has(waiting), waiting).toBe(true)

    // An answer by either person sorts the shop's payments, and the next question comes.
    const eatingBefore = (await app.budgetRow(MONTH, 'Food - Not Essential')).actual_amount_cents
    const firstAnswer = stub.button(tango, 'Food - Not Essential')
    stub.tap(PARTNER, tango, firstAnswer)
    await expect.poll(() => tango.text, { timeout: 15_000 }).toBe('Tango Sample: Food - Not Essential. 2 payments sorted.')
    // R-013: the answer made no rule; the answered question offers to remember the shop.
    expect(labels(tango)).toEqual(['Remember Tango Sample for next time'])
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern === 'tango sample')).toEqual([])
    expect((await rows('Tango Sample')).map(t => [t.confirmed, t.category_name, t.categorised_by])).toEqual([[true, 'Food - Not Essential', 'manual'], [true, 'Food - Not Essential', 'manual']])
    expect((await app.budgetRow(MONTH, 'Food - Not Essential')).actual_amount_cents).toBe(eatingBefore + 4000)
    await expect.poll(() => asked().length, { timeout: 20_000 }).toBe(3)
    expect(asked().map(m => m.text.split(' · ')[0])).toEqual(['Mw P Voorbeeld', 'Sample Webshop', 'Kiosk Onbekend'])
    // A second tap on an answered question changes nothing.
    stub.tap(DANIEL, tango, firstAnswer)

    // R-013: asked to, the shop is remembered. Its later payments are sorted the same way, with no question and without asking Claude.
    expect((await rows('Tango Sample')).length, 'the second tap sorted nothing again').toBe(2)
    stub.tap(PARTNER, tango, stub.button(tango, 'Remember Tango Sample'))
    await expect.poll(() => tango.text, { timeout: 15_000 }).toBe('Tango Sample: Food - Not Essential. 2 payments sorted.\nRemembered: “tango sample” → Food - Not Essential.')
    expect(labels(tango)).toEqual([])
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern === 'tango sample').map(r => r.category_name)).toEqual(['Food - Not Essential'])
    const calls = app.sorterCalls().length
    const later = await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-14', 'Tango Sample 99 Utrecht', -500)]))
    expect(later.summary.text.split('\n')).toEqual(['ING import: 1 new payment.', '1 sorted and counted.'])
    expect((await rows('Tango Sample 99'))[0]).toMatchObject({ confirmed: true, category_name: 'Food - Not Essential', categorised_by: 'rule' })
    expect(app.sorterCalls().length, 'Claude was not asked about a remembered shop').toBe(calls)
    expect(showingSince(later.count).filter(isQuestion)).toHaveLength(0)
    // And a waiting payment of that shop that no question named follows the answer at once.
    addWaiting([{ description: 'Kiosk Onbekend Filiaal 2', cents: -150, category: await idOf('Miscellaneous'), date: '2026-11-11' }])
    const kiosk = asked().find(m => m.text.startsWith('Kiosk Onbekend'))!
    stub.tap(DANIEL, kiosk, stub.button(kiosk, 'Miscellaneous'))
    await expect.poll(() => kiosk.text, { timeout: 15_000 }).toBe('Kiosk Onbekend: Miscellaneous. 2 payments sorted.')
    expect((await rows('Kiosk Onbekend')).map(t => [t.confirmed, t.category_name])).toEqual([[true, 'Miscellaneous'], [true, 'Miscellaneous']])
    // Left unpressed, the offer remembers nothing.
    expect(labels(kiosk)).toEqual(['Remember Kiosk Onbekend for next time'])
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern.startsWith('kiosk'))).toEqual([])

    // Money that came back from a shop: the button books it as a refund, and that is not made a rule.
    const clothingBefore = (await app.budgetRow(MONTH, 'Clothing')).actual_amount_cents
    stub.tap(PARTNER, webshop, stub.button(webshop, 'Refund: Clothing'))
    await expect.poll(() => webshop.text, { timeout: 15_000 }).toBe('Sample Webshop: Refund: Clothing. 1 payment sorted.')
    expect(labels(webshop), 'a refund is not offered as a rule').toEqual([])
    expect((await rows('Sample Webshop'))[0]).toMatchObject({ confirmed: true, is_refund: true, category_name: 'Clothing' })
    expect((await app.budgetRow(MONTH, 'Clothing')).actual_amount_cents).toBe(clothingBefore - 2000)
    expect((await app.json<any[]>('/rules')).some(r => r.pattern.includes('webshop'))).toBe(false)

    // "Something else": answered in words, through a card; the question then closes itself.
    let sent = stub.sent.length
    stub.tap(DANIEL, person, stub.button(person, 'Something else'))
    expect((await stub.reply_after(sent, () => true)).text).toBe('Tell me in a few words what Mw P Voorbeeld is, and I will sort it.')
    // Pressed again, it is not asked twice.
    stub.tap(PARTNER, person, stub.button(person, 'Something else'))
    await quiet()
    expect(showingSince(sent).filter(m => m.text.startsWith('Tell me in a few words'))).toHaveLength(1)
    const voorbeeld = (await rows('Mw P Voorbeeld'))[0]
    // With other questions open too, Claude is told which payment the words are about: the app's request is the
    // last thing said before them, and it names the payment.
    const conversation = conversationOf(await echo(DANIEL, 'that was the plumber'))
    expect(conversation.find((e: any) => e.asked?.startsWith('Mw P Voorbeeld'))).toMatchObject({ from: 'app', transaction_ids: [voorbeeld.id] })
    expect(conversation.at(-1)).toEqual({
      from: 'app', asked_after_something_else: 'Tell me in a few words what Mw P Voorbeeld is, and I will sort it.', transaction_ids: [voorbeeld.id],
    })
    sent = stub.sent.length
    stub.text(DANIEL, propose('the plumber, I said', 'Move it.', 'transaction.update', { id: voorbeeld.id, category_id: await idOf('Home & DIY') }))
    const card = await stub.reply_after(sent, isCard)
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    await expect.poll(() => person.text, { timeout: 15_000 }).toBe('Mw P Voorbeeld: Sorted as Home & DIY.')
    expect(labels(person)).toEqual([])
    // The applied card offers to remember the one shop it sorted, by name.
    const ruleFor = async (pattern: string) => (await app.json<any[]>('/rules')).filter(r => r.pattern === pattern).map(r => r.category_name)
    expect(await ruleFor('mw p voorbeeld')).toEqual([])
    expect(labels(card)).toEqual(['Remember Mw P Voorbeeld for next time', 'Undo'])
    stub.tap(DANIEL, card, stub.button(card, 'Remember Mw P Voorbeeld'))
    await expect.poll(() => card.text.split('\n').at(-1), { timeout: 15_000 }).toBe('Remembered: “mw p voorbeeld” → Home & DIY.')
    expect(labels(card)).toEqual(['Undo'])
    expect(await ruleFor('mw p voorbeeld')).toEqual(['Home & DIY'])

    // R-011: an automatically sorted payment can still be changed. The correction is remembered for the shop when asked.
    await app.json(`/transactions/${supermarket.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Food - Not Essential'), remember: true }) })
    expect((await rows('Sample Supermarket'))[0]).toMatchObject({ confirmed: true, category_name: 'Food - Not Essential', categorised_by: 'manual' })
    expect(await ruleFor('sample supermarket')).toEqual(['Food - Not Essential'])

    // The last one is answered in the app's review list instead, which closes its question.
    await expect.poll(() => asked().some(m => m.text.startsWith('Zzz Unknown')), { timeout: 20_000 }).toBe(true)
    const zzz = asked().find(m => m.text.startsWith('Zzz Unknown'))!
    expect(labels(zzz)).toEqual(['Miscellaneous', 'Something else'])
    const unknown = (await rows('Zzz Unknown'))[0]
    await app.json(`/transactions/${unknown.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Home & DIY'), confirmed: true }) })
    await expect.poll(() => zzz.text, { timeout: 15_000 }).toBe('Zzz Unknown: Sorted as Home & DIY.')

    // A payment Claude gave no answer for at all waits too and is asked about, with no guess to offer.
    sortsAs([])
    const unsorted = await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-12', 'Qqq Unsorted', -100)]))
    expect(unsorted.summary.text.split('\n')).toEqual(['ING import: 1 new payment.', '1 needs your answer, which I will ask about here.'])
    const qqq = await stub.reply_after(unsorted.count, m => m.text.startsWith('Qqq Unsorted'))
    expect(labels(qqq)).toEqual(['Something else'])
    expect((await rows('Qqq Unsorted'))[0]).toMatchObject({ confirmed: false, category_id: null })
    await app.json(`/transactions/${(await rows('Qqq Unsorted'))[0].id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Miscellaneous'), confirmed: true }) })
    await expect.poll(() => qqq.text, { timeout: 15_000 }).toBe('Qqq Unsorted: Sorted as Miscellaneous.')
    expect((await pace()).to_review, 'the pile is back to where it was').toBe(waitingBefore)
    await quiet()
    expect(asked().filter(m => labels(m).length > 0), 'no question is left open').toHaveLength(0)
  })

  test('R-013: a payment through a service that hides the shop is asked about each time and never becomes a rule', async () => {
    sortsAs([unsure(0, 'Miscellaneous', ['Miscellaneous', 'Food - Not Essential']), unsure(1, 'Miscellaneous', ['Miscellaneous', 'Food - Not Essential'])])
    const first = await importInTelegram(DANIEL, ingCsv([
      ingRow('2026-11-12', 'AAB INZ TIKKIE', -1200, 'etentje'), ingRow('2026-11-13', 'AAB INZ TIKKIE', -3400, 'cadeau'),
    ]))
    const asked = () => showingSince(first.count).filter(isQuestion).filter(m => m.text.startsWith('AAB INZ TIKKIE'))
    await expect.poll(() => asked().length, { timeout: 20_000 }).toBe(2) // one question each, not one for both
    expect(asked().map(m => m.text).sort()).toEqual([
      'AAB INZ TIKKIE · 12 Nov · -€12,00 · “etentje”\n\nWhere does it belong?', 'AAB INZ TIKKIE · 13 Nov · -€34,00 · “cadeau”\n\nWhere does it belong?',
    ])
    const dinner = asked().find(m => m.text.includes('12 Nov'))!
    stub.tap(PARTNER, dinner, stub.button(dinner, 'Food - Not Essential'))
    expect(dinner.html, 'what the payer typed stands in italics').toContain(' · <i>“etentje”</i>')
    await expect.poll(() => dinner.text, { timeout: 15_000 }).toBe('AAB INZ TIKKIE: Food - Not Essential. 1 payment sorted.')
    expect(labels(dinner), 'a payment service is never offered as a rule').toEqual([])
    const tikkies = await rows('AAB INZ TIKKIE')
    expect(tikkies.find(t => t.amount_cents === -1200)).toMatchObject({ confirmed: true, category_name: 'Food - Not Essential' })
    expect(tikkies.find(t => t.amount_cents === -3400), 'the other one still waits').toMatchObject({ confirmed: false })
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern.includes('tikkie'))).toEqual([])
    // The next one is asked about again.
    sortsAs([unsure(0, 'Miscellaneous', ['Miscellaneous'])])
    const later = await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-14', 'AAB INZ TIKKIE', -500, 'koffie')]))
    expect(later.summary.text.split('\n')[1]).toBe('1 needs your answer, which I will ask about here.')
    expect((await rows('AAB INZ TIKKIE')).find(t => t.amount_cents === -500)).toMatchObject({ confirmed: false })
    // Answered in the app instead: still no rule.
    for (const tx of (await rows('AAB INZ TIKKIE')).filter(t => !t.confirmed)) {
      await app.json(`/transactions/${tx.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Miscellaneous'), confirmed: true }) })
    }
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern.includes('tikkie'))).toEqual([])
    await quiet()

    // The other services, as the bank writes them: an answer sorts that payment and is never made a rule, even
    // when asked to remember it. A shop that only pays through one ("Sample Boekhandel via Mollie") is a shop, and is.
    const hidden = [
      'Stg Mollie Payments', 'Klarna Bank AB', 'Stichting Derdengelden Buckaroo', 'Stg Adyen', 'Riverty Netherlands B.V.',
      'Stripe Technology Europe Ltd', 'ING Bank NV inzake Tikkie', 'PayPal Europe S.a.r.l. et Cie S.C.A',
    ]
    const names = [...hidden, 'Sample Boekhandel via Mollie']
    sortsAs(Array.from({ length: names.length * 2 }, (_, i) => unsure(i, 'Miscellaneous', ['Miscellaneous'])))
    const services = await importInTelegram(PARTNER, ingCsv(names.flatMap((name, i) => [
      ingRow('2026-11-12', name, -1000 - i, 'een'), ingRow('2026-11-13', name, -2000 - i, 'twee'),
    ])))
    expect(services.summary.text.split('\n')[1]).toBe('18 need your answer, which I will ask about here.')
    const rulesBefore = new Set((await app.json<any[]>('/rules')).map(r => r.id))
    for (const name of names) {
      const [first, second] = (await rows(name)).sort((a, b) => b.amount_cents - a.amount_cents)
      await app.json(`/transactions/${first.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Home & DIY'), confirmed: true, remember: true }) })
      const other = (await rows(name)).find(t => t.id === second.id)!
      if (hidden.includes(name)) expect(other, `${name}: the next payment still waits`).toMatchObject({ confirmed: false })
      else expect(other, `${name}: a shop, so its other payment follows`).toMatchObject({ confirmed: true, category_name: 'Home & DIY' })
    }
    const made = async () => (await app.json<any[]>('/rules')).filter(r => !rulesBefore.has(r.id)).map(r => r.pattern)
    expect(await made()).toEqual(['sample boekhandel via mollie'])
    for (const tx of (await app.transactions()).filter(t => !t.confirmed && hidden.includes(t.description))) {
      await app.json(`/transactions/${tx.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Miscellaneous'), confirmed: true, remember: true }) })
    }
    expect(await made(), 'and answering the rest made no rule either').toEqual(['sample boekhandel via mollie'])
    await quiet()
  })

  test('R-001: what Telegram itself says in the group (someone joined, a message was pinned) gets no reply', async () => {
    const count = stub.sent.length
    const saved = (await telegram()).length
    stub.other(DANIEL, 'new_chat_members')
    stub.other(PARTNER, 'pinned_message')
    stub.other(DANIEL, 'left_chat_member')
    await new Promise(resolve => setTimeout(resolve, 3000))
    expect(stub.sent.length).toBe(count)
    expect((await telegram()).length).toBe(saved)
  })

  test('R-012: an import on the Import page asks in the group too, and a payment answered in the app closes its question', async () => {
    sortsAs([unsure(0, 'Recreation & Entertainment', ['Recreation & Entertainment', 'Miscellaneous'])])
    const count = stub.sent.length
    await page.goto(`${app.base}/import`)
    await page.locator('#csv-file').setInputFiles({ name: 'ing.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow('2026-11-12', 'Pretpark Voorbeeld', -4500)])) })
    await page.getByRole('button', { name: 'Preview import' }).click()
    await page.getByRole('button', { name: 'Import 1 new transaction' }).click()
    await expect(page.getByText('needs your answer')).toBeVisible()
    const question = await stub.reply_after(count, isQuestion)
    expect(question.text).toBe('Pretpark Voorbeeld · 12 Nov · -€45,00\n\nWhere does it belong?')
    expect(labels(question)).toEqual(['Recreation & Entertainment', 'Miscellaneous', 'Something else'])
    // Answered in the app's review list instead.
    await page.goto(`${app.base}/transactions`)
    const review = page.locator('.rev')
    await expect(review).toContainText('Pretpark Voorbeeld')
    await expect(review).toContainText('Claude wasn’t sure. Which is it?Recreation & EntertainmentClaude’s guess')
    // The review card remembers the shop only when its box is ticked.
    const box = review.getByRole('checkbox', { name: 'Remember this shop for next time' })
    await expect(box).not.toBeChecked()
    await box.check()
    await shot(page, 'review-remember-desktop')
    await review.getByRole('button', { name: 'Confirm category' }).click()
    await expect.poll(async () => (await rows('Pretpark Voorbeeld'))[0].confirmed, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => question.text, { timeout: 15_000 }).toBe('Pretpark Voorbeeld: Sorted as Recreation & Entertainment.')
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern === 'pretpark voorbeeld').map(r => r.category_name)).toEqual(['Recreation & Entertainment'])
  })

  test('R-016: money moved to a name entered in Setup as the household\'s own is sorted into "To personal accounts" from the first time', async () => {
    const before = await pace()
    // A transfer that is already waiting when the names are entered.
    addWaiting([{ description: 'Mw P Partnernaam', cents: -3000, category: await idOf('Miscellaneous'), date: '2026-11-12' }])
    await page.goto(`${app.base}/setup`)
    const section = page.locator('section[aria-labelledby="own-names-title"]')
    await section.locator('#own-name-0').fill('M Eigennaam')
    await section.locator('#own-name-1').fill('P Partnernaam')
    await section.getByRole('button', { name: 'Save' }).click()
    await expect(section.getByRole('status')).toHaveText('Saved')
    expect((await app.json<any>('/settings')).own_names).toBe('M Eigennaam;P Partnernaam')
    expect((await rows('Mw P Partnernaam'))[0]).toMatchObject({ confirmed: true, category_name: 'To personal accounts' })
    // New transfers, however the bank writes the name around it, are sorted at once with no question.
    sortsAs([unsure(0, 'Miscellaneous'), unsure(1, 'Miscellaneous'), unsure(2, 'Miscellaneous')])
    const { summary, count } = await importInTelegram(PARTNER, ingCsv([
      ingRow('2026-11-13', 'Hr M Eigennaam', -6000, 'naar eigen rekening'),
      ingRow('2026-11-13', 'M EIGENNAAM  via bunq', -4000, 'spaties en hoofdletters'),
      ingRow('2026-11-13', 'M Anderenaam', -2000, 'iemand anders'),
    ]))
    expect(summary.text.split('\n')[1]).toBe('2 sorted and counted, 1 needs your answer, which I will ask about here.')
    for (const own of ['Hr M Eigennaam', 'M EIGENNAAM']) {
      expect((await rows(own))[0], own).toMatchObject({ confirmed: true, category_name: 'To personal accounts', categorised_by: 'rule' })
    }
    expect((await rows('M Anderenaam'))[0].confirmed).toBe(false)
    const asked = showingSince(count).filter(isQuestion)
    expect(asked.map(m => m.text.split(' · ')[0])).toEqual(['M Anderenaam'])
    const after = await pace()
    expect(after.spendable_actual_cents).toBe(before.spendable_actual_cents + 3000 + 6000 + 4000)
    expect(after.free.free_cents).toBe(before.free.free_cents - 13000)
    // Money coming in from an own name is not touched by this, and a name too short to be safe is refused.
    for (const bad of ['ab', 'a;b', 'One Name;Two Name;Three Name;Four Name;Five Name']) {
      const refused = await fetch(`${app.base}/api/settings/own_names`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: bad }) })
      expect(refused.status, bad).toBe(422)
    }
    await page.reload()
    await expect(section.locator('#own-name-0')).toHaveValue('M Eigennaam')
    await expect(section.locator('#own-name-1')).toHaveValue('P Partnernaam')
    stub.tap(DANIEL, asked[0], stub.button(asked[0], 'Miscellaneous'))
    await expect.poll(() => asked[0].text, { timeout: 15_000 }).toContain('sorted')
  })

  test('R-016: only a name entered in Setup counts as the household\'s own, not one that pays in every month; the category counts as spending and can be planned', async () => {
    const personal = await app.category('To personal accounts')
    expect(personal.type).toBe('wants')
    // A name that pays in as income month after month, as the tax office does with an allowance.
    sortsAs([sure(0, 'Other Income'), sure(1, 'Other Income')])
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-09-25', 'BELASTING VOORBEELD', 25000, 'toeslag sep'), ingRow('2026-10-25', 'BELASTING VOORBEELD', 25000, 'toeslag okt')]))
    expect((await rows('BELASTING VOORBEELD')).every(t => t.confirmed && t.category_name === 'Other Income')).toBe(true)
    const before = await pace()
    const personalBefore = (await app.budgetRow(MONTH, 'To personal accounts')).actual_amount_cents
    // Money going out to that name is not the household moving money to itself: it is sorted like any payment.
    // A transfer to a name from Setup (entered in the test before) is.
    sortsAs([sure(0, 'Taxes & Mortgage'), unsure(1, 'Miscellaneous', ['Miscellaneous', 'Taxes & Mortgage']), unsure(2, 'Miscellaneous')])
    const { summary, count } = await importInTelegram(PARTNER, ingCsv([
      ingRow('2026-11-12', 'BELASTING VOORBEELD', -15000, 'aanslag'),
      ingRow('2026-11-13', 'BELASTING VOORBEELD', -2500, 'naheffing'),
      ingRow('2026-11-12', 'Mw P Partnernaam', -4000, 'naar eigen rekening'),
    ]))
    expect(summary.text.split('\n')[1]).toBe('2 sorted and counted, 1 needs your answer, which I will ask about here.')
    const paid = await rows('BELASTING VOORBEELD')
    expect(paid.find(t => t.amount_cents === -15000)).toMatchObject({ confirmed: true, category_name: 'Taxes & Mortgage', categorised_by: 'ai' })
    expect(paid.find(t => t.amount_cents === -2500), 'a doubtful one waits for an answer').toMatchObject({ confirmed: false })
    expect((await rows('Mw P Partnernaam')).find(t => t.amount_cents === -4000)).toMatchObject({ confirmed: true, category_name: 'To personal accounts', categorised_by: 'rule' })
    const asked = showingSince(count).filter(isQuestion)
    expect(asked.map(m => m.text.split(' · ')[0])).toEqual(['BELASTING VOORBEELD'])
    expect(labels(asked[0])).toEqual(['Miscellaneous', 'Taxes & Mortgage', 'Something else'])
    // The transfer counts as spending and lowers what is free to spend.
    const after = await pace()
    expect((await app.budgetRow(MONTH, 'To personal accounts')).actual_amount_cents).toBe(personalBefore + 4000)
    expect(after.spendable_actual_cents).toBe(before.spendable_actual_cents + 15000 + 4000)
    expect(after.free.free_cents).toBe(before.free.free_cents - 19000)
    // The category can be given a planned amount like any other.
    const row = await app.budgetRow(MONTH, 'To personal accounts')
    await app.json(`/budget/${row.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: 20000 }) })
    const planned = await pace()
    expect(planned.spendable_plan_cents).toBe(after.spendable_plan_cents + 20000)
    expect(planned.free.free_cents).toBe(after.free.free_cents + 20000)
    // Saying where the doubtful one belongs does not make that name the household's own either.
    stub.tap(DANIEL, asked[0], stub.button(asked[0], 'Taxes & Mortgage'))
    await expect.poll(() => asked[0].text, { timeout: 15_000 }).toBe('BELASTING VOORBEELD: Taxes & Mortgage. 1 payment sorted.')
    expect((await rows('BELASTING VOORBEELD')).filter(t => t.amount_cents < 0).map(t => t.category_name)).toEqual(['Taxes & Mortgage', 'Taxes & Mortgage'])
    expect((await app.budgetRow(MONTH, 'To personal accounts')).actual_amount_cents).toBe(personalBefore + 4000)
    await quiet()
  })

  test('R-017: "free to spend until payday" leads the Month page and the bot with one figure, lists the bills it allows for, and leaves out one marked as not fixed', async () => {
    const p = await pace()
    const left = p.spendable_plan_cents - p.spendable_actual_cents
    expect(p.free.bills.map((b: any) => [b.name, b.amount_cents, b.next_date])).toEqual([['Sample Energy NV', 14500, '2026-11-20']])
    expect(p.free).toMatchObject({ left_in_plan_cents: left, bills_cents: 14500, set_aside_cents: 0, free_cents: left - 14500 })
    expect(p.free.per_day_cents, 'today and the eight days after it').toBe(Math.floor((left - 14500) / 9))

    // The Month page (since its "Left to spend" redesign) gives the same figure as "to stay in budget": what is free
    // until payday, a day; its working-out lists the fixed bills it allows for.
    await page.goto(app.base)
    const verdict = page.locator('.verdict')
    const inBudget = verdict.locator('.cell', { hasText: 'To stay in budget' })
    await expect(inBudget).toContainText(wholeEuro(p.free.per_day_cents))
    await expect(inBudget).toContainText('a day, for 9 days')
    await expect(verdict.locator('.verdict-sub')).toContainText(/until payday, 23 Nov/i)
    await verdict.locator('.free-how > summary').click()
    await expect(verdict.locator('.ledger')).toContainText(`${wholeEuro(left)} left in the plan (less fixed bills and set-asides)`)
    await expect(verdict.locator('.ledger dl')).toContainText('Fixed bills still to come- €145')
    const bill = verdict.locator('.free-list li', { hasText: 'Sample Energy NV' })
    await expect(bill).toContainText('due 20 Nov')
    await expect(bill).toContainText('€145')
    await expect(verdict.locator('.free-list li')).toHaveCount(1) // the rent is already paid this month, so it is not listed
    await shot(page, 'just-works-free-to-spend')

    // The bot is given the same figure, and leads with it.
    const told = contextOf(await echo(PARTNER, 'How are we doing?')).this_month
    expect(told).toMatchObject({
      free_to_spend_cents: p.free.free_cents, free_per_day_cents: p.free.per_day_cents,
      fixed_bills_still_to_come_cents: 14500, set_aside_this_month_cents: 0, left_in_plan_cents: left,
    })
    expect(told.upcoming_bills.map((b: any) => b.name)).toEqual(['Sample Energy NV'])
    // What the model is told to lead with (its system prompt, which the scripted model is not shown).
    expect(readFileSync(path.join(repo, 'backend', 'assistant', 'prompts.py'), 'utf8')).toContain('free_to_spend_cents is the app\'s headline')

    // Marked as not a fixed bill: it is left out, on the page and for the bot.
    await bill.getByRole('button', { name: 'Sample Energy NV is not a fixed bill' }).click()
    await expect(verdict.locator('.free-list li', { hasText: 'Sample Energy NV' })).toHaveCount(0)
    const without = await pace()
    expect(without.free).toMatchObject({ bills_cents: 0, bills: [], free_cents: left })
    await expect(inBudget).toContainText(wholeEuro(without.free.per_day_cents))
    expect((await app.json<any>('/recurring')).items.find((i: any) => i.name === 'Sample Energy NV').state).toBe('ignored')
    // It can be counted again from the list of repeating payments.
    await page.getByRole('button', { name: /Nothing more to pay|still to pay|Recurring payments/ }).first().click()
    const sheet = page.getByRole('dialog', { name: 'Recurring payments' })
    await sheet.getByRole('button', { name: /Sample Energy NV/ }).click()
    await sheet.getByRole('button', { name: 'Count as a fixed bill again' }).click()
    await expect.poll(async () => (await pace()).free.bills_cents, { timeout: 10_000 }).toBe(14500)
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(inBudget).toContainText(wholeEuro(p.free.per_day_cents))

    // When more is spent than was free, it says by how much the month is over.
    const big = await app.addManual(TODAY, -(left - 14500 + 12345), 'Sample Big Spend', 'Miscellaneous')
    await page.reload()
    await expect(inBudget).toContainText(`${wholeEuro(12345)} over`)
    await expect(inBudget).toContainText('plan used up')
    expect((await pace()).free).toMatchObject({ free_cents: -12345, per_day_cents: null })
    await app.json(`/transactions/${big.id}`, { method: 'DELETE' })
    await page.reload()
    await expect(inBudget).toContainText(wholeEuro(p.free.per_day_cents))

    // A past month has no "to stay in budget": it says what was left over.
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(verdict.locator('h1')).toHaveText(/^Left over/)
    await expect(verdict).not.toContainText('To stay in budget')
  })

  test('R-018: a set-aside spreads a bill over the months to its due month, lowers free to spend, and its payment comes out of what was set aside', async () => {
    const before = await pace()
    await page.goto(`${app.base}/setup`)
    const section = page.locator('section[aria-labelledby="set-asides-title"]')
    await section.getByRole('button', { name: 'Add a set-aside' }).click()
    await section.locator('#set-aside-name').fill('Car insurance')
    await section.locator('#set-aside-amount').fill('600')
    await section.locator('#set-aside-due').fill('2027-04')
    await section.getByRole('button', { name: 'Add set-aside' }).click()
    const bill = section.locator('[data-set-aside="Car insurance"]')
    // Six months from November to April: €100 a month.
    await expect(bill).toContainText('€600 due April 2027 · every year · €100 this month · €100 set aside so far')
    const kept = await pace()
    expect(kept.free).toMatchObject({ set_aside_cents: 10000, free_cents: before.free.free_cents - 10000, set_asides: [{ name: 'Car insurance', monthly_cents: 10000 }] })
    expect(kept.spendable_actual_cents, 'setting aside is not spending').toBe(before.spendable_actual_cents)
    const months = async (label: string) => (await app.json<any>(`/set-asides?month=${label}`)).items[0]
    expect(await months('2027-01')).toMatchObject({ monthly_cents: 10000, saved_cents: 30000 })
    expect(await months('2027-04')).toMatchObject({ monthly_cents: 10000, saved_cents: 60000 })
    expect(await months('2027-05'), 'a yearly bill starts again over twelve months').toMatchObject({ monthly_cents: 5000, saved_cents: 5000, due_month: '2028-04' })
    // On the Month page (its "Left to spend" redesign): what may still be spent a day allows for it, and the working-out names it.
    await page.goto(app.base)
    await expect(page.locator('.verdict .cell', { hasText: 'To stay in budget' })).toContainText(wholeEuro(kept.free.per_day_cents))
    await page.locator('.free-how > summary').click()
    await expect(page.locator('.ledger dl')).toContainText('Set aside this month- €100')
    await expect(page.locator('.free-list[aria-label="Set aside this month"] li', { hasText: 'Car insurance' })).toContainText('€100')

    // The bill is paid: first it counts as ordinary spending and against the month's pace.
    await app.addRule('sample insurer', 'Insurance')
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-13', 'Sample Insurer Direct', -60000, 'jaarpremie')]))
    const paid = await pace()
    const insurance = (await app.budgetRow(MONTH, 'Insurance')).actual_amount_cents
    expect(paid.spendable_actual_cents).toBe(kept.spendable_actual_cents + 60000)
    expect(paid.pace_delta_cents).toBe(kept.pace_delta_cents + 60000)
    // Marked as the bill, it comes out of what was set aside: the €100 set aside so far no longer counts,
    // and the €500 that had not been set aside yet stays as spending this month.
    await page.goto(`${app.base}/setup`)
    await bill.getByRole('button', { name: 'Mark as paid' }).click()
    await bill.locator('select').selectOption({ label: '13 Nov · Sample Insurer Direct · €600,00' })
    await bill.getByRole('button', { name: 'Paid from this set-aside' }).click()
    await expect(bill).toContainText('paid 13 Nov')
    await expect(bill).toContainText('Paid with Sample Insurer Direct, €600,00 · €500,00 of it was not set aside yet and counts as spending')
    const settled = await pace()
    expect(settled.spendable_actual_cents).toBe(kept.spendable_actual_cents + 50000)
    expect(settled.pace_delta_cents).toBe(kept.pace_delta_cents + 50000)
    expect((await app.budgetRow(MONTH, 'Insurance')).actual_amount_cents).toBe(insurance - 10000)
    expect(settled.free.free_cents, 'this month\'s share is still set aside').toBe(kept.free.free_cents - 50000)
    expect((await months('2026-12')).monthly_cents, 'nothing more to set aside for a bill that is paid').toBe(0)
    expect((await months('2027-05')).monthly_cents).toBe(5000)
    await page.goto(`${app.base}/transactions`)
    await expect(page.locator('tr', { hasText: 'Sample Insurer' }).first().locator('.tx-tag', { hasText: 'set aside' })).toBeVisible()

    // The link can be undone.
    await page.goto(`${app.base}/setup`)
    await bill.getByRole('button', { name: 'Not this payment' }).click()
    await expect(bill).toContainText('€100 this month')
    expect((await pace()).spendable_actual_cents).toBe(kept.spendable_actual_cents + 60000)

    // A bill that was set aside for in full comes out of that entirely: it counts in no month and not against the pace.
    await app.addRule('sample sweep', 'Home & DIY')
    await app.post('/set-asides', { name: 'Chimney sweep', amount_cents: 8000, due_month: '2026-11', every_months: null })
    const saved = await pace()
    expect(saved.free.set_aside_cents).toBe(18000)
    const diyBefore = (await app.budgetRow(MONTH, 'Home & DIY')).actual_amount_cents
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-14', 'Sample Sweep Schoorsteen', -8000, 'vegen')]))
    const swept = await pace()
    expect(swept.spendable_actual_cents).toBe(saved.spendable_actual_cents + 8000)
    const sweep = (await app.json<any>('/set-asides')).items.find((i: any) => i.name === 'Chimney sweep')
    const sweepPayment = (await rows('Sample Sweep'))[0]
    await app.post(`/set-asides/${sweep.id}/payments`, { transaction_id: sweepPayment.id })
    const covered = await pace()
    expect(covered.spendable_actual_cents, 'counts in no month').toBe(saved.spendable_actual_cents)
    expect(covered.pace_delta_cents, 'not against the month\'s pace').toBe(saved.pace_delta_cents)
    expect(covered.daily.at(-1).cumulative_cents).toBe(saved.daily.at(-1).cumulative_cents)
    expect((await app.budgetRow(MONTH, 'Home & DIY')).actual_amount_cents).toBe(diyBefore)
    expect((await app.json<any>('/set-asides')).items.find((i: any) => i.name === 'Chimney sweep').payment).toMatchObject({ counted_cents: 0 })
    expect(covered.free.free_cents, 'its share was already taken off what is free').toBe(saved.free.free_cents)
    // A payment with no category cannot settle a bill that was not set aside for in full: its rest would count nowhere.
    addWaiting([{ description: 'Sample Loose Payment', cents: -50000, category: await idOf('Miscellaneous'), date: '2026-11-12' }])
    const loose = (await rows('Sample Loose Payment'))[0]
    app.sql(`UPDATE transactions SET category_id = NULL WHERE id = ${loose.id}`)
    const car = (await app.json<any>('/set-asides')).items.find((i: any) => i.name === 'Car insurance')
    const refusedPay = await fetch(`${app.base}/api/set-asides/${car.id}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transaction_id: loose.id }) })
    expect(refusedPay.status).toBe(422)
    expect((await refusedPay.json()).detail).toContain('Give that payment a category first')
    app.sql(`DELETE FROM transactions WHERE id = ${loose.id}`)
    await app.json(`/set-asides/${sweep.id}`, { method: 'DELETE' })

    // A one-off bill does not come back.
    await app.post('/set-asides', { name: 'Holiday', amount_cents: 90000, due_month: '2027-01', every_months: null })
    expect((await app.json<any>('/set-asides?month=2026-11')).items.find((i: any) => i.name === 'Holiday')).toMatchObject({ monthly_cents: 30000 })
    expect((await app.json<any>('/set-asides?month=2027-02')).items.find((i: any) => i.name === 'Holiday')).toMatchObject({ monthly_cents: 0, over: true })
    expect((await pace()).free.set_aside_cents).toBe(40000)
    // Wrong input is refused in plain words.
    const refuse = async (body: object) => (await fetch(`${app.base}/api/set-asides`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    expect((await refuse({ name: 'Past', amount_cents: 1000, due_month: '2026-10' })).status).toBe(422)
    expect((await refuse({ name: ' ', amount_cents: 1000, due_month: '2027-01' })).status).toBe(422)
    expect((await refuse({ name: 'Zero', amount_cents: 0, due_month: '2027-01' })).status).toBe(422)
    // Deleting gives the amounts back to free to spend.
    await page.reload()
    page.once('dialog', dialog => dialog.accept())
    await section.locator('[data-set-aside="Holiday"]').getByRole('button', { name: 'Delete Holiday' }).click()
    await expect(section.locator('[data-set-aside="Holiday"]')).toHaveCount(0)
    page.once('dialog', dialog => dialog.accept())
    await bill.getByRole('button', { name: 'Delete Car insurance' }).click()
    await expect(bill).toHaveCount(0)
    expect((await pace()).free.set_aside_cents).toBe(0)
  })

  test('R-018: the bot can make a set-aside and say a payment was its bill, through cards', async () => {
    let count = stub.sent.length
    stub.text(DANIEL, propose('set aside 240 for road tax in February', 'Set aside for the road tax.', 'set_aside.add', { name: 'Road tax', amount_cents: 24000, due_month: '2027-02', every_months: 12 }))
    const card = await stub.reply_after(count, isCard)
    expect(card.text).toContain('New: Set-aside “Road tax”: €240,00, February 2027')
    expect((await app.json<any>('/set-asides')).items).toHaveLength(0)
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    const made = (await app.json<any>('/set-asides')).items[0]
    expect(made).toMatchObject({ name: 'Road tax', monthly_cents: 6000 })
    const insurer = (await rows('Sample Insurer Direct'))[0]
    count = stub.sent.length
    stub.text(DANIEL, propose('the insurer payment was the road tax', 'That payment was the road tax.', 'set_aside.pay', { id: made.id, transaction_id: insurer.id }))
    const pay = await stub.reply_after(count, isCard)
    expect(pay.text).toContain('Sample Insurer Direct · 13 Nov · -⁠€600,00: paid from Road tax')
    await cardShown()
    stub.tap(DANIEL, pay, stub.button(pay, 'Apply'))
    await expect.poll(() => pay.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    expect((await rows('Sample Insurer Direct'))[0].set_aside_name).toBe('Road tax')
    await app.json(`/set-asides/${made.id}`, { method: 'DELETE' })
    expect((await rows('Sample Insurer Direct'))[0].set_aside_id).toBeNull()
  })

  test('R-019: the household sets its own target split, which must add up to 100, and the Month page and planner measure against it', async () => {
    expect((await app.json<any>('/settings')).target_split).toBe('50/30/20')
    await page.goto(`${app.base}/setup`)
    const section = page.locator('section[aria-labelledby="target-split-title"]')
    const fields = [0, 1, 2].map(i => section.locator(`#split-${i}`))
    for (const [i, value] of ['50', '30', '20'].entries()) await expect(fields[i]).toHaveValue(value)
    const planner = page.locator('section', { has: page.getByRole('heading', { name: 'Budget', exact: true }) })
    await expect(planner).toContainText('aim 50%')
    await expect(planner).toContainText('The tick marks your target split, 50/30/20.')

    // Percentages that do not add up to 100 cannot be saved.
    await fields[0].fill('60')
    await expect(section.getByRole('alert')).toContainText('must be whole numbers that add up to 100; these add up to 110')
    await expect(section.getByRole('button', { name: 'Save' })).toBeDisabled()
    for (const bad of ['60/30/20', '60/25', '60/25/15/0', 'a/b/c', '60.5/24.5/15', '-10/60/50']) {
      const refused = await fetch(`${app.base}/api/settings/target_split`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: bad }) })
      expect(refused.status, bad).toBe(422)
    }
    expect((await app.json<any>('/settings')).target_split).toBe('50/30/20')

    await fields[1].fill('25')
    await fields[2].fill('15')
    await section.getByRole('button', { name: 'Save' }).click()
    await expect(section.getByRole('status')).toHaveText('Saved')
    expect((await app.json<any>('/settings')).target_split).toBe('60/25/15')
    await expect(planner).toContainText('aim 60%')
    await expect(planner).toContainText('aim 25%')
    await expect(planner).toContainText('aim 15%')
    await expect(planner).toContainText('The tick marks your target split, 60/25/15.')
    await expect(planner).not.toContainText('50/30/20')

    // The Month page compares needs, wants and savings with it, as shares of this month's income.
    await page.goto(app.base)
    const summary = await app.json<any>(`/dashboard/summary?month=${MONTH}`)
    const p = await pace()
    // (Since the Month page's redesign each group heading says it.)
    for (const [kind, label, aim] of [['needs', 'Needs', 60], ['wants', 'Wants', 25], ['savings', 'Savings', 15]] as const) {
      const share = Math.round((p.actual_cents[kind] / summary.total_income_cents) * 100)
      await expect(page.locator(`section.cat-group[aria-label="${label}"] .kind-share`)).toContainText(`${share}% of income, aim ${aim}%`)
    }
    await shot(page, 'just-works-target-split')
  })

  test('R-020: a changed planned amount applies from its month on, and earlier months keep theirs', async () => {
    const planned = async (month: string, category: string) => (await app.budgetRow(month, category)).planned_amount_cents
    // Months that were opened before the change, and months never opened.
    expect(await planned('2026-10', 'Clothing')).toBe(10000)
    expect(await planned('2026-12', 'Clothing')).toBe(10000)
    await page.goto(app.base)
    await openCategory('Clothing')
    const field = page.locator('.cat-detail').getByLabel('Planned')
    await field.fill('140')
    await field.blur()
    await expect.poll(() => planned(MONTH, 'Clothing'), { timeout: 10_000 }).toBe(14000)
    expect(await planned('2026-12', 'Clothing'), 'a later month already opened').toBe(14000)
    expect(await planned('2027-03', 'Clothing'), 'a later month never opened').toBe(14000)
    expect(await planned('2026-10', 'Clothing'), 'the month before').toBe(10000)
    expect(await planned('2026-08', 'Clothing'), 'an earlier month never opened').toBe(10000)
    // Changed again in a later month: from there on only.
    const march = await app.budgetRow('2027-03', 'Clothing')
    await app.json(`/budget/${march.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: 9000 }) })
    expect(await planned('2027-02', 'Clothing')).toBe(14000)
    expect(await planned('2027-03', 'Clothing')).toBe(9000)
    expect(await planned('2027-06', 'Clothing')).toBe(9000)
    expect(await planned(MONTH, 'Clothing')).toBe(14000)
    // The earlier month changed afterwards: that carries forward up to the month that was changed again,
    // which keeps its own amount, as do the months after it.
    const november = await app.budgetRow(MONTH, 'Clothing')
    const changed = await app.json<any>(`/budget/${november.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: 12000 }) })
    const openBeforeMarch = app.value(`SELECT COUNT(*) FROM budgets WHERE category_id = ${november.category_id} AND month >= '${MONTH}-01' AND month < '2027-03-01'`)[0][0]
    expect(changed.months_changed, 'November and the open months up to March').toBe(openBeforeMarch)
    expect(openBeforeMarch).toBeGreaterThanOrEqual(3)
    expect(await planned(MONTH, 'Clothing')).toBe(12000)
    expect(await planned('2026-12', 'Clothing')).toBe(12000)
    expect(await planned('2027-01', 'Clothing'), 'a month in between, never opened').toBe(12000)
    expect(await planned('2027-02', 'Clothing')).toBe(12000)
    expect(await planned('2027-03', 'Clothing'), 'changed by hand: keeps its own').toBe(9000)
    expect(await planned('2027-06', 'Clothing')).toBe(9000)
    expect(await planned('2026-10', 'Clothing')).toBe(10000)

    // The Setup planner saves the same way, and says so.
    await page.goto(`${app.base}/setup`)
    await expect(page.getByText('A changed amount stays for the months after November too; earlier months keep theirs.')).toBeVisible()
    // (The planner's groups start folded.)
    await expect(page.locator('.bud-fold').first()).toBeVisible()
    const closed = page.locator('.bud-fold[aria-expanded="false"]')
    while (await closed.count() > 0) await closed.first().click()
    await page.getByLabel('Home & DIY planned amount').fill('175')
    await page.getByRole('button', { name: 'Save plan' }).click()
    await expect.poll(() => planned(MONTH, 'Home & DIY'), { timeout: 10_000 }).toBe(17500)
    expect(await planned('2027-01', 'Home & DIY')).toBe(17500)
    expect(await planned('2026-10', 'Home & DIY')).toBe(10000)

    // Through the bot, with no month named: from this month on.
    const count = stub.sent.length
    stub.text(PARTNER, propose('plan 80 for recreation from now on', 'Plan less for recreation.', 'budget.set', { category_id: await idOf('Recreation & Entertainment'), planned_amount_cents: 8000 }))
    const card = await stub.reply_after(count, isCard)
    expect(card.text).toContain('Budget for Recreation & Entertainment, November 2026: planned €100,00 → €80,00')
    await cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toMatch(/^Applied\./)
    expect(await planned(MONTH, 'Recreation & Entertainment')).toBe(8000)
    expect(await planned('2027-04', 'Recreation & Entertainment')).toBe(8000)
    expect(await planned('2026-10', 'Recreation & Entertainment')).toBe(10000)
    // A negative plan is refused.
    const row = await app.budgetRow(MONTH, 'Clothing')
    expect((await fetch(`${app.base}/api/budget/${row.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: -100 }) })).status).toBe(422)
  })

  test('R-021: Month and Transactions always show the way to Import, with the date the bank data runs to', async () => {
    const newest = (await pace()).newest_bank_date
    expect((await pace()).status, 'the month has bank data').toBe('ok')
    const label = new Date(`${newest}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    for (const where of ['', '/transactions']) {
      await page.goto(`${app.base}${where}`)
      const link = page.getByRole('link', { name: /^Import/ })
      await expect(link).toBeVisible()
      await expect(link).toContainText(`bank data to ${label}`)
      await link.click()
      await expect(page).toHaveURL(/\/import$/)
      await expect(page.getByRole('heading', { name: 'Bring in an ING file' })).toBeVisible()
    }
    // On an earlier month too.
    await page.goto(app.base)
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByRole('link', { name: /^Import/ })).toContainText(`bank data to ${label}`)
  })

  test('R-022: only ING is offered or named anywhere, and the DEGIRO savings category is untouched', async () => {
    await page.goto(`${app.base}/import`)
    await expect(page.locator('body')).not.toContainText(/Revolut|DEGIRO|Choose the bank/i)
    await expect(page.getByText('Choose the ING file')).toBeVisible()
    await page.goto(`${app.base}/transactions`)
    await page.getByRole('button', { name: 'Source' }).click()
    await expect(page.getByRole('option')).toHaveText(['All sources', 'ING', 'MANUAL'])
    await page.keyboard.press('Escape')
    // The API takes no other source.
    const asRevolut = new FormData()
    asRevolut.append('source', 'revolut')
    asRevolut.append('file', new Blob(['Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-11-02 10:00:00,2026-11-03 10:00:00,Test Cafe,-4.50,0.00,EUR,COMPLETED,100.00\n']), 'r.csv')
    expect((await fetch(`${app.base}/api/import/confirm`, { method: 'POST', body: asRevolut })).status).toBe(422)
    expect(new Set((await app.transactions()).map(t => t.source))).toEqual(new Set(['ing', 'manual']))
    expect((await pace()).last_import_by_bank.map((b: any) => b.source)).toEqual(['ing'])
    // No mention of them as a source in the app, the bot or the documents. The savings category named DEGIRO stays.
    const mentions = execFileSync('git', ['grep', '--untracked', '-n', '-i', '-I', '-E', 'revolut|degiro', '--', 'backend', 'frontend/src', 'deploy', 'README.md', 'SETUP.md', 'AGENTS.md', 'PRODUCT.md', 'DESIGN.md', 'docs', 'contracts', ':!backend/alembic', ':!backend/tests', ':!frontend/src/tests', ':!docs/superpowers'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean)
    const allowed = /("DEGIRO",\s+CategoryType\.savings|'DEGIRO':\s+TrendingUp|may come back|could come back)/
    expect(mentions.filter(line => !allowed.test(line))).toEqual([])
    const degiro = await app.category('DEGIRO')
    expect(degiro).toMatchObject({ type: 'savings' })
    expect((await app.budgetRow(MONTH, 'DEGIRO')).planned_amount_cents).toBe(30000)
  })

  test('R-023: rules have no priority, and the most specific rule that fits a payment wins', async () => {
    // Whichever was made first.
    await app.addRule('sample deli', 'Food - Essential')
    await app.addRule('sample deli to go', 'Food - Not Essential')
    await app.addRule('quick snack corner', 'Food - Not Essential')
    await app.addRule('quick snack', 'Food - Essential')
    const calls = app.sorterCalls().length
    await importInTelegram(DANIEL, ingCsv([
      ingRow('2026-11-12', 'Sample Deli To Go 44 Enschede', -450),
      ingRow('2026-11-12', 'Sample Deli 12 Enschede', -2300),
      ingRow('2026-11-12', 'Quick Snack Corner Utrecht', -600),
      ingRow('2026-11-12', 'Quick Snack Utrecht', -700),
    ]))
    const sorted = async (prefix: string) => (await rows(prefix)).map(t => [t.description, t.category_name, t.categorised_by])
    expect(await sorted('Sample Deli')).toEqual(expect.arrayContaining([
      ['Sample Deli To Go 44 Enschede', 'Food - Not Essential', 'rule'], ['Sample Deli 12 Enschede', 'Food - Essential', 'rule'],
    ]))
    expect(await sorted('Quick Snack')).toEqual(expect.arrayContaining([
      ['Quick Snack Corner Utrecht', 'Food - Not Essential', 'rule'], ['Quick Snack Utrecht', 'Food - Essential', 'rule'],
    ]))
    expect(app.sorterCalls().length).toBe(calls)
    // Two equally specific rules: the older one, as before.
    await app.addRule('tie shop a', 'Clothing')
    await app.addRule('ie shop ab', 'Home & DIY')
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-12', 'Tie Shop AB', -100)]))
    expect((await rows('Tie Shop AB'))[0].category_name).toBe('Clothing')
    // A short rule text fits as a word of its own only: "esso" sorts the filling station, not the espresso bar.
    await app.addRule('esso', 'Transportation')
    sortsAs([sure(0, 'Food - Not Essential')])
    await importInTelegram(PARTNER, ingCsv([
      ingRow('2026-11-12', 'Esso Express Enschede', -4000), ingRow('2026-11-12', 'ESSO123 Tankstation', -3000),
      ingRow('2026-11-12', 'Tank-Esso.nl', -2000), ingRow('2026-11-12', 'Espresso Bar Sample', -350),
    ]))
    expect((await app.transactions()).filter(t => /esso/i.test(t.description)).map(t => [t.description, t.category_name, t.categorised_by]).sort()).toEqual([
      ['ESSO123 Tankstation', 'Transportation', 'rule'], ['Espresso Bar Sample', 'Food - Not Essential', 'ai'],
      ['Esso Express Enschede', 'Transportation', 'rule'], ['Tank-Esso.nl', 'Transportation', 'rule'],
    ])
    // A rule that fits nothing else behaves as it always did: the seed's Albert Heijn rule.
    expect((await rows('Albert Heijn 1234')).every(t => t.category_name === 'Food - Essential' && t.categorised_by === 'rule')).toBe(true)

    // A name that starts with a number keeps it in the rule an answer makes: the town alone is never a rule.
    sortsAs([unsure(0, 'Miscellaneous', ['Miscellaneous'])])
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-12', '1448 Enschede Enschede NLD', -1063)]))
    const numbered = (await rows('1448 Enschede'))[0]
    await app.json(`/transactions/${numbered.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: await idOf('Food - Essential'), confirmed: true, remember: true }) })
    const patterns = (await app.json<any[]>('/rules')).map(r => r.pattern)
    expect(patterns).toContain('1448 enschede enschede')
    expect(patterns.filter(p => p.startsWith('enschede'))).toEqual([])
    sortsAs([sure(0, 'Clothing')])
    await importInTelegram(DANIEL, ingCsv([ingRow('2026-11-13', 'Sample Kleding Enschede Enschede NLD', -1230)]))
    expect((await rows('Sample Kleding'))[0]).toMatchObject({ category_name: 'Clothing', categorised_by: 'ai' })
    await quiet()

    // No priority anywhere: not in what the app returns, takes, or shows.
    const rules = await app.json<any[]>('/rules')
    expect(rules.every(r => !('priority' in r))).toBe(true)
    const withPriority = await fetch(`${app.base}/api/rules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pattern: 'prio shop', category_id: await idOf('Clothing'), priority: 5 }) })
    expect(withPriority.status).toBe(422)
    expect(app.value("SELECT COUNT(*) FROM pragma_table_info('rules') WHERE name = 'priority'")).toEqual([[0]])
    await page.goto(`${app.base}/setup`)
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Rules', exact: true }) })).not.toContainText(/priority/i)
    // A rule too short to be safe is refused.
    const blank = await fetch(`${app.base}/api/rules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pattern: ' ', category_id: await idOf('Clothing') }) })
    expect(blank.status).toBe(422)
  })

  test('R-025: the Month page no longer changes what a category counts as; Setup does, and asks first when the category is in use', async () => {
    await page.goto(app.base)
    await openCategory('Clothing')
    const detail = page.locator('.cat-detail')
    await expect(detail.getByLabel('Planned')).toBeVisible()
    await expect(detail.getByLabel('Counts as')).toHaveCount(0)
    await expect(detail.locator('select')).toHaveCount(0)

    await page.goto(`${app.base}/setup`)
    // An unused category changes at once.
    await app.post('/categories', { name: 'Sample Movable', type: 'wants' })
    await page.reload()
    await page.getByLabel('Sample Movable counts as').selectOption('needs')
    await expect.poll(async () => (await app.category('Sample Movable')).type, { timeout: 10_000 }).toBe('needs')
    // One with payments asks first; declining leaves it, accepting changes it.
    const cash = page.getByLabel('Cash Withdrawal counts as')
    await app.addManual(TODAY, -2000, 'Sample Cash Use', 'Cash Withdrawal')
    page.once('dialog', dialog => { expect(dialog.message()).toContain('"Cash Withdrawal" already has payments or rules'); void dialog.dismiss() })
    await cash.selectOption('needs')
    await new Promise(resolve => setTimeout(resolve, 800))
    expect((await app.category('Cash Withdrawal')).type).toBe('wants')
    const needsBefore = (await pace()).actual_cents.needs
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await page.getByLabel('Cash Withdrawal counts as').selectOption('needs')
    await expect.poll(async () => (await app.category('Cash Withdrawal')).type, { timeout: 10_000 }).toBe('needs')
    expect((await pace()).actual_cents.needs).toBe(needsBefore + 2000)
    await app.json(`/categories/${(await app.category('Cash Withdrawal')).id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'wants', force: true }) })
  })

  test('R-026: the JSON backup is gone and the CSV export still works', async () => {
    await page.goto(`${app.base}/setup`)
    const data = page.locator('section.rep-data')
    await expect(data).toBeVisible()
    await expect(data).not.toContainText(/back ?up everything|JSON/i)
    await expect(page.getByRole('link', { name: /Back up/i })).toHaveCount(0)
    expect((await fetch(`${app.base}/api/reports/backup`)).status).toBe(404)
    const [download] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: /All transactions/ }).click()])
    expect(download.suggestedFilename()).toMatch(/transactions.*\.csv$/)
    const csv = readFileSync(await download.path(), 'utf8')
    expect(csv.split('\n').length).toBeGreaterThan(20)
    expect(csv).toContain('Sample Rent Housing')
  })
})
