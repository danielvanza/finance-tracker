/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { App, DANIEL, GROUP, PARTNER, TelegramStub, euro, ingCsv, ingRow, startBot } from './fixtures'

// "Just works for two" with the real Claude (the machine's login, in its sandbox) on synthetic data: the parts
// that rest on Claude's own judgement. Everything else is in just-works-controlled and just-works-upgrade.
const NOW = '2026-11-15T12:00'
const app = new App({ port: 18781 })
const stub = new TelegramStub(18782)
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
let stopBot: () => void

const isCard = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Apply')
const isQuestion = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Something else')
const labels = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.text)
const rows = async (prefix: string) => (await app.transactions()).filter(t => t.description.toLowerCase().includes(prefix.toLowerCase()))
const telegram = async () => (await app.json('/chat/messages?channel=telegram')).messages

async function quiet() {
  await expect.poll(async () => {
    const box = await app.json<any>('/chat/outbox?channel=telegram')
    return box.replies.length + box.edits.length + box.in_flight.length
  }, { timeout: 280_000, intervals: [500] }).toBe(0)
  await new Promise(resolve => setTimeout(resolve, 1500))
}

/** The card Claude made for the newest message in the group, as the app holds it. */
async function newestCard() {
  const messages = await telegram()
  return messages.filter((m: any) => m.card).at(-1).card
}

test.describe.serial('just works for two, with the real Claude', () => {
  test.beforeAll(async () => {
    app.clock(NOW)
    await app.start()
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await app.addRule('salaris voorbeeld', 'Salary')
    await app.addRule('sample rent', 'Taxes & Mortgage')
    await app.addRule('sample energy', 'Utilities')
    await app.importCsv(ingCsv([
      ...['2026-08-24', '2026-09-24', '2026-10-24'].map((day, i) => ingRow(day, 'Salaris Voorbeeld BV', 300000, `pay ${i}`)),
      ...['2026-09-01', '2026-10-01', '2026-11-01'].map((day, i) => ingRow(day, 'Sample Rent Housing', -120000, `rent ${i}`)),
      ...['2026-08-20', '2026-09-20', '2026-10-20'].map((day, i) => ingRow(day, 'Sample Energy NV', -14500, `energy ${i}`)),
    ]))
  })

  test.afterAll(async () => {
    stopBot()
    await stub.stop()
    await app.stop()
    app.destroy()
  })

  test('R-011 R-012 R-013: the real Claude calls plain shops sure and people and unknown names doubtful; the sure ones count, the others are asked about', async () => {
    const before = await app.json<any>('/dashboard/pace')
    const count = stub.sent.length
    stub.document(PARTNER, 'export.csv', ingCsv([
      ingRow('2026-11-12', 'ALBERT HEIJN 1172 ENSCHEDE NLD', -4215),
      ingRow('2026-11-12', 'Vattenfall Klantenservice N.V.', -14500),
      ingRow('2026-11-13', 'Zilveren Kruis Zorgverzekeringen NV', -15795),
      ingRow('2026-11-13', 'Shell Express Enschede NLD', -6210),
      ingRow('2026-11-13', 'Mw A de Vries', -7500),
      ingRow('2026-11-14', 'XQZ 8841 Holding', -1999),
      ingRow('2026-11-14', 'Hr P Bakker', 4000),
    ]))
    const summary = await stub.reply_after(count, m => m.text.startsWith('ING import'))
    expect(summary.text).toContain('7 new payments')
    await quiet()

    // The plain ones are counted without anyone confirming, in a fitting category, and marked as automatic.
    const expectSure = async (name: string, categories: string[]) => {
      const [tx] = await rows(name)
      expect(tx.confirmed, `${name} counts at once`).toBe(true)
      expect(tx.categorised_by, name).toBe('ai')
      expect(categories, `${name} is in ${tx.category_name}`).toContain(tx.category_name)
    }
    await expectSure('ALBERT HEIJN', ['Food - Essential'])
    await expectSure('Vattenfall', ['Utilities'])
    await expectSure('Zilveren Kruis', ['Insurance', 'Medical & Healthcare'])
    await expectSure('Shell Express', ['Transportation'])
    const after = await app.json<any>('/dashboard/pace')
    expect(after.spendable_actual_cents).toBe(before.spendable_actual_cents + 4215 + 14500 + 15795 + 6210)

    // A person's name, an unknown name and money from a person are not sure: they wait and count nowhere.
    for (const doubtful of ['Mw A de Vries', 'XQZ 8841', 'Hr P Bakker']) {
      const [tx] = await rows(doubtful)
      expect(tx.confirmed, `${doubtful} waits`).toBe(false)
    }
    expect(after.to_review).toBe(before.to_review + 3)
    expect(summary.text).toContain('4 sorted and counted, 3 need your answer')
    const asked = stub.sent.slice(count).filter(m => !m.deleted && m.chat_id === GROUP && isQuestion(m))
    expect(asked).toHaveLength(3)
    expect(asked.map(m => m.text.split(',')[0]).sort()).toEqual(['Hr P Bakker', 'Mw A de Vries', 'XQZ 8841 Holding'].sort())
    for (const question of asked) expect(labels(question).length, question.text).toBeGreaterThanOrEqual(2)

    // One is answered by a button, and that is remembered: the next payment to her is sorted without a question.
    const vries = asked.find(m => m.text.startsWith('Mw A de Vries'))!
    const choice = labels(vries)[0]
    stub.tap(DANIEL, vries, stub.button(vries, choice))
    await expect.poll(() => vries.text, { timeout: 20_000 }).toBe(`Mw A de Vries: ${choice}. 1 payment sorted, and remembered for next time.`)
    const again = stub.sent.length
    stub.document(DANIEL, 'next.csv', ingCsv([ingRow('2026-11-14', 'Mw A de Vries', -2500, 'second')]))
    expect((await stub.reply_after(again, m => m.text.startsWith('ING import'))).text).toContain('1 sorted and counted.')
    expect((await rows('Mw A de Vries')).every(t => t.confirmed && t.category_name === choice)).toBe(true)

    // Another is answered in words: Claude makes a card for it, and the question closes when it is applied.
    await quiet()
    const xqz = asked.find(m => m.text.startsWith('XQZ'))!
    const sent = stub.sent.length
    stub.text(PARTNER, 'The XQZ payment was a new lamp for the living room')
    const card = await stub.reply_after(sent, isCard)
    expect(card.text).toContain('XQZ 8841 Holding')
    await app.cardShown()
    stub.tap(PARTNER, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 20_000 }).toMatch(/^Applied\./)
    const [lamp] = await rows('XQZ 8841')
    expect(lamp).toMatchObject({ confirmed: true })
    expect(['Home & DIY', 'Miscellaneous']).toContain(lamp.category_name)
    await expect.poll(() => xqz.text, { timeout: 20_000 }).toBe(`XQZ 8841 Holding: Sorted as ${lamp.category_name}.`)
  })

  test('R-017: asked how the month is going, Claude leads with what is free to spend, in the Month page\'s own figure', async () => {
    await app.post('/chat/new', { channel: 'telegram' })
    await quiet()
    const p = await app.json<any>('/dashboard/pace')
    const count = stub.sent.length
    stub.text(PARTNER, 'How are we doing this month?')
    const reply = await stub.reply_after(count, m => m.text.includes('€') && !isQuestion(m) && !m.text.startsWith('Working on it'))
    await quiet()
    expect(reply.text).toContain(euro(p.free.free_cents))
    expect(reply.text.toLowerCase()).toContain('free to spend')
    expect(reply.text.indexOf(euro(p.free.free_cents)), 'it leads with it').toBeLessThan(260)
    expect(reply.text, 'a chat message, not a report').not.toMatch(/\*\*|^#/m)
    expect(reply.text.length).toBeLessThan(900)
    expect(stub.sent.slice(count).filter(m => !m.deleted && m.chat_id === GROUP && !isQuestion(m)), 'one message').toHaveLength(1)
  })

  test('R-004: a voice note gives the same card as typing the same words', async () => {
    const card = async (send: () => void) => {
      await app.post('/chat/new', { channel: 'telegram' })
      await quiet()
      const count = stub.sent.length
      send()
      const shown = await stub.reply_after(count, isCard)
      await quiet()
      const held = await newestCard()
      const text = shown.text
      stub.tap(DANIEL, shown, stub.button(shown, 'Not this'))
      await expect.poll(() => shown.text, { timeout: 20_000 }).toContain('Not applied')
      return { text, held }
    }
    const typed = await card(() => stub.text(DANIEL, 'fifteen euros cash at the market'))
    const spoken = await card(() => stub.voice(PARTNER, readFileSync(path.join(assets, 'voice-fifteen-euros-market.ogg'))))
    const facts = (held: any) => {
      expect(held.lines, held.lines.join(' / ')).toHaveLength(1)
      const line = held.lines[0] as string
      expect(line).toMatch(/^Add: .+ · 15 Nov · -⁠€15,00, in .+$/)
      return { amountAndDay: line.slice(line.indexOf(' · 15 Nov')), category: line.split(', in ').at(-1) }
    }
    expect(facts(spoken.held)).toEqual(facts(typed.held))
    expect(spoken.text).toMatch(/^Heard: “(15|fifteen) euros cash at the market\.?”/i)
    expect(typed.text).not.toContain('Heard:')
    expect((await rows('market')).length, 'nothing was added without Apply').toBe(0)
  })

  test('R-005: Claude reads a receipt photo into a proposed payment with the shop, amount and date, and says so when a photo cannot be read', async () => {
    await app.post('/chat/new', { channel: 'telegram' })
    await quiet()
    const before = app.dump()
    let count = stub.sent.length
    stub.photo(PARTNER, readFileSync(path.join(assets, 'receipt-bakery.png')))
    const shown = await stub.reply_after(count, isCard)
    await quiet()
    const held = await newestCard()
    expect(held.lines).toHaveLength(1)
    expect(held.lines[0]).toMatch(/^Add: .*Korenbloem.* · 11 Nov · -⁠€7,80, in /i)
    expect(app.dump(), 'nothing changes without Apply').toEqual(before)
    await app.cardShown()
    stub.tap(DANIEL, shown, stub.button(shown, 'Apply'))
    await expect.poll(() => shown.text, { timeout: 20_000 }).toMatch(/^Applied\./)
    const [bakery] = await rows('Korenbloem')
    expect(bakery).toMatchObject({ date: '2026-11-11', amount_cents: -780, source: 'manual', confirmed: true })

    // A photo with nothing to read on it: said plainly, no card, nothing changed.
    await app.post('/chat/new', { channel: 'telegram' })
    await quiet()
    const settled = app.dump()
    count = stub.sent.length
    const blank = readFileSync(path.join(assets, 'photo-blank.png'))
    stub.photo(DANIEL, blank)
    const reply = await stub.reply_after(count, m => !m.text.startsWith('Working on it') && !isQuestion(m))
    await quiet()
    expect(isCard(reply)).toBe(false)
    expect(reply.text.toLowerCase()).toMatch(/can(no|')t (read|see|make)|could ?n(o|')t (read|see|make)|unable to|nothing (on|in)|blank|no (receipt|payment|text)|not (able|show)|doesn't show|does not show/)
    expect((await telegram()).filter((m: any) => m.card && m.card.status === 'pending')).toHaveLength(0)
    expect(app.dump()).toEqual(settled)
  })
})
