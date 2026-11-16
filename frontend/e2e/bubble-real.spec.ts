/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { App, ingCsv, ingRow, monthDates, openChat, repo, say, script, seedHistory, shot } from './fixtures'

// Finance's chat on bot-kit, end to end: the real app, the real bubble, the real Claude login in botkit's sandbox,
// on synthetic data only. botkit's scripted model ("Test script") stands in where a fixed sequence is the point
// (a stale card, Stop at a known moment). Every check reads what was stored: the finance database and the chat's
// own store (bot.db), not only what the screen or the API says.
const app = new App({ port: 18782 })
const d = monthDates()
const assets = path.join(repo, 'frontend', 'e2e', 'assets')
let page: Page

const cards = () => app.botValue('SELECT id, kind, status, args FROM bot_cards ORDER BY id')
  .map(([id, kind, status, args]) => ({ id, kind, status, args: JSON.parse(args) }))
const manual = (like: string) => app.value(`SELECT id, amount, category_id, confirmed FROM transactions WHERE source = 'manual' AND lower(description) LIKE '%${like}%'`) as any[]
const reply = () => page.locator('.bk-thread > li').last()

async function openOn(route = '/') {
  await page.goto(app.base + route)
  await openChat(page)
}

/** Says something in the bubble and waits for its answer to land. */
async function sayAndWait(text: string) {
  await say(page, text)
  await expect(page.locator('.bk-me').last()).toContainText(text.split('\n')[0].slice(0, 30))
  await app.settled()
  await expect(page.locator('[data-testid="bk-pending"]')).toHaveCount(0, { timeout: 20_000 })
}

test.describe.serial('the chat on bot-kit, with the real Claude login', () => {
  test.beforeAll(async ({ browser }) => {
    await app.start()
    await seedHistory(app, d)
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => localStorage.setItem('life.theme-override', JSON.stringify({ theme: 'day', until: Date.now() + 86_400_000 })))
  })

  test.afterAll(async () => {
    await page.close()
    await app.stop()
    app.destroy()
  })

  test('a question that needs a lookup is answered correctly, in the live log, and changes nothing', async () => {
    await openOn('/')
    const before = app.dump()
    await sayAndWait('How much did we spend at Sample Bakery in total, over all the months in the data? Please look it up.')
    // Seven months with two bakery payments each, €4,50 and €5,50: €70,00 in all.
    await expect(reply()).toContainText(/€\s?70(,00)?\b/)
    await expect(page.locator('.bk-log-done summary').last()).toContainText(/Worked through · \d+ steps?/)
    const asked = app.botValue("SELECT steps FROM bot_messages WHERE role = 'user' ORDER BY id DESC LIMIT 1")[0][0]
    expect(JSON.parse(asked).length, 'each lookup is a step in the live log').toBeGreaterThan(0)
    expect(app.dump(), 'a lookup changes nothing').toEqual(before)
    await shot(page, 'real-lookup')
  })

  test('a card changes nothing until Apply, and Apply twice applies it once', async () => {
    await sayAndWait('I paid €7,50 in cash at the Saturday market today, for vegetables. Please add it.')
    const card = page.locator('.bk-card[data-state="open"]').last()
    await expect(card).toBeVisible()
    await expect(card).toContainText('€7,50')
    expect(manual('market'), 'nothing is added before Apply').toHaveLength(0)
    const held = cards().at(-1)
    expect(held).toMatchObject({ kind: 'transaction.add', status: 'open' })
    const version = (await app.conversation()).messages.find((m: any) => m.card?.id === held.id).card.version

    // A tap and a second Apply for the same version at the same moment, then one more: one payment.
    await Promise.all([
      card.getByRole('button', { name: 'Apply' }).click(),
      app.post(`/chat/cards/${held.id}/apply`, { version }),
    ])
    await expect(page.locator('[data-state="applied"]').last()).toContainText('Done.')
    await app.post(`/chat/cards/${held.id}/apply`, { version })
    expect(manual('market')).toHaveLength(1)
    expect(manual('market')[0][1]).toBe(-7.5)
    expect(cards().find(c => c.id === held.id)!.status).toBe('applied')
    await shot(page, 'real-card-applied')
  })

  test('a card whose data changed shows a fresh preview instead of applying', async () => {
    await app.useRunner('script', 'script')
    const [[txId]] = manual('market')
    const [clothing, recreation] = [await app.category('Clothing'), await app.category('Recreation & Entertainment')]
    await sayAndWait(script(['make_change', { kind: 'transaction.update', summary: 'Move the market payment to Recreation.', args: { id: txId, category_id: recreation.id } }],
      'SCRIPT-SAY Here it is.'))
    const card = page.locator('.bk-card[data-state="open"]').last()
    await expect(card).toContainText('→ Recreation & Entertainment')
    // Someone moves the payment on the Transactions page meanwhile.
    await app.json(`/transactions/${txId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: clothing.id }) })
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card.locator('.bk-stale')).toContainText('Something changed since this was shown, so nothing was applied.')
    await expect(card).toContainText('Clothing → Recreation & Entertainment')
    expect(manual('market')[0][2], 'nothing was applied').toBe(clothing.id)
    expect(cards().at(-1)!.status).toBe('open')
    await shot(page, 'script-stale-card')
    // The fresh preview applies.
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('[data-state="applied"]').last()).toContainText('Done.')
    expect(manual('market')[0][2]).toBe(recreation.id)
  })

  test('a bank file sent in the chat is imported and sorted, and the unsure payment is asked about with buttons and Remember', async () => {
    const before = (app.value('SELECT COUNT(*) FROM transactions') as any[])[0][0]
    const file = ingCsv([
      ingRow(d.today, 'Albert Heijn 1234', -2345, 'groceries'),
      ingRow(d.today, 'Jan de Vries', -2500, ''),
      ingRow(d.today, 'Pizzeria Napoli Utrecht', -3200, ''),
    ])
    await page.getByTestId('bk-attach-input').setInputFiles({ name: 'ing-november.csv', mimeType: 'text/csv', buffer: Buffer.from(file) })
    await expect(page.locator('.bk-me .hf-file').last()).toContainText('ing-november.csv')
    await app.settled()
    const imported = page.locator('.hf-import').last()
    await expect(imported).toContainText('New3')
    expect((app.value('SELECT COUNT(*) FROM transactions') as any[])[0][0]).toBe(before + 3)
    expect(app.botValue("SELECT kind FROM bot_messages WHERE kind IN ('file', 'import') ORDER BY id").map(r => r[0])).toEqual(['file', 'import'])
    await shot(page, 'real-import')

    // Jan de Vries is a person: Claude is not sure, so it waits, uncounted, and is asked about in the group.
    const [[janId, janConfirmed]] = app.value("SELECT id, confirmed FROM transactions WHERE description = 'Jan de Vries'") as any[]
    expect(janConfirmed).toBe(0)
    let question: any
    await expect.poll(async () => {
      question = (await app.conversation('telegram')).messages.find((m: any) => m.kind === 'question' && m.payload.transaction_ids.includes(janId))
      return Boolean(question)
    }, { timeout: 60_000 }).toBe(true)
    expect(question.payload.status).toBe('open')
    const labels = question.buttons.map((b: any) => b.label)
    expect(labels.at(-1)).toBe('Something else')
    expect(question.buttons[0]).toMatchObject({ action: 'answer', value: 0 })
    const chosen = question.payload.options[0]

    const answered = await app.post(`/chat/messages/${question.id}/actions/answer`, { value: 0 })
    expect(answered.payload.status).toBe('answered')
    expect(answered.payload.result).toContain('1 payment sorted')
    expect(app.value(`SELECT category_id, confirmed FROM transactions WHERE id = ${janId}`)).toEqual([[chosen.category_id, 1]])
    expect(answered.buttons).toEqual([{ action: 'remember', label: expect.stringMatching(/^Remember Jan de Vries for next time$/i) }])
    expect(app.value("SELECT COUNT(*) FROM rules WHERE pattern LIKE '%vries%'")).toEqual([[0]])

    const remembered = await app.post(`/chat/messages/${question.id}/actions/remember`, {})
    expect(remembered.buttons).toEqual([])
    expect(remembered.payload.result).toMatch(/Remembered: “jan de vries” →/)
    expect(app.value("SELECT pattern, category_id FROM rules WHERE pattern LIKE '%vries%'")).toEqual([['jan de vries', chosen.category_id]])
    // A second tap remembers nothing more.
    await app.post(`/chat/messages/${question.id}/actions/remember`, {})
    expect(app.value("SELECT COUNT(*) FROM rules WHERE pattern LIKE '%vries%'")).toEqual([[1]])
  })

  test('Stop ends a reply and a partial answer follows, with nothing changed', async () => {
    const before = app.dump()
    const lookup = ['run_query', { doing: 'Checking the bakery', queries: ["SELECT SUM(spend_cents) AS spent_cents FROM spending WHERE merchant LIKE '%bakery%'"] }] as [string, object]
    await say(page, script('SCRIPT-SLOW 3', lookup, lookup, lookup, lookup, 'SCRIPT-SAY Never said.'))
    const working = page.locator('[data-testid="bk-pending"]')
    await expect(working.locator('[data-testid="bk-steps"] li').first()).toContainText('Checking the bakery')
    await working.getByRole('button', { name: 'Stop' }).click()
    await app.settled()
    await expect(reply()).toContainText('I stopped early, so this is partial.')
    await expect(page.locator('.bk-log-done summary').last()).toContainText('Stopped')
    const [[payload]] = app.botValue("SELECT payload FROM bot_messages WHERE role = 'user' ORDER BY id DESC LIMIT 1")
    expect(JSON.parse(payload).ended).toBe('stopped')
    await expect(page.locator('.bk-reply', { hasText: 'Never said.' }), 'the words it would have ended with never came').toHaveCount(0)
    expect(app.dump()).toEqual(before)
    await shot(page, 'script-stopped')
  })

  test('the runner picker keeps its choice after a reload', async () => {
    await page.locator('.bk-picker-trigger').click()
    const claude = page.locator('.bk-runner', { has: page.locator('.bk-runner-name', { hasText: /^Claude Code$/ }) })
    await claude.getByRole('button', { name: 'Haiku' }).click()
    await expect(page.locator('.bk-picker-trigger')).toContainText('Claude Code · Haiku')
    await page.reload()
    await openChat(page)
    await expect(page.locator('.bk-picker-trigger')).toContainText('Claude Code · Haiku')
    expect((await app.json('/chat/runners?channel=bubble')).selected).toEqual({ runner: 'claude-cli', model: 'haiku' })
    const conversation = (await app.conversation()).conversation.id
    expect(app.botValue(`SELECT runner, model FROM bot_conversations WHERE id = ${conversation}`)).toEqual([['claude-cli', 'haiku']])
  })

  test('a runner that cannot run fails with its plain reason, and nothing changes', async () => {
    await page.locator('.bk-picker-trigger').click()
    const api = page.locator('.bk-runner', { has: page.locator('.bk-runner-name', { hasText: /^Claude API$/ }) })
    await expect(api).toHaveAttribute('data-unavailable', '')
    await expect(api.locator('.bk-runner-detail')).toContainText('No API key')
    await expect(api.locator('.bk-model').first()).toBeDisabled()
    await shot(page, 'picker-unavailable')
    await page.keyboard.press('Escape')
    // The picker greys it out, but the API takes the choice (botkit SPEC §9), and then it must fail plainly.
    await app.useRunner('claude-api', 'claude-sonnet-5-5')
    await page.reload()
    await openChat(page)
    const before = app.dump()
    const cardsBefore = cards().length
    await sayAndWait('Add a €3 coffee from today, please.')
    await expect(page.locator('.bk-reply.bk-error').last()).toHaveText('Claude API has no API key set up, so it cannot answer. Nothing changed.')
    expect(app.dump()).toEqual(before)
    expect(cards()).toHaveLength(cardsBefore)
    await shot(page, 'runner-no-key')
    await app.useRunner('claude-cli', 'sonnet')
  })

  test('New chat starts an empty conversation that keeps the runner, and withdraws open cards', async () => {
    await app.useRunner('script', 'script')
    await page.reload()
    await openChat(page)
    const [[txId]] = manual('market')
    await sayAndWait(script(['make_change', { kind: 'transaction.delete', summary: 'Delete the market payment.', args: { id: txId } }], 'SCRIPT-SAY Shall I?'))
    const open = cards().at(-1)!
    expect(open.status).toBe('open')
    const old = (await app.conversation()).conversation.id
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await page.getByRole('button', { name: 'Start new chat' }).click()
    await expect(page.locator('.bk-thread > li')).toHaveCount(0)
    await expect(page.locator('.bk-intro')).toBeVisible()
    const fresh = (await app.conversation()).conversation
    expect(fresh.id).toBeGreaterThan(old)
    expect([fresh.runner, fresh.model]).toEqual(['script', 'script'])
    expect(cards().find(c => c.id === open.id)!.status).toBe('superseded')
    expect(manual('market'), 'a withdrawn card changes nothing').toHaveLength(1)
    expect(app.botValue(`SELECT kind FROM bot_messages WHERE conversation_id = ${old} ORDER BY id DESC LIMIT 1`)).toEqual([['new_chat']])
  })

  test('the starters differ per page, and one tapped is sent as the person\'s message', async () => {
    const shown: Record<string, string[]> = {}
    for (const route of ['/', '/transactions', '/import', '/trends']) {
      await openOn(route)
      await expect(page.locator('.bk-starters .bk-btn').first()).toBeVisible()
      shown[route] = await page.locator('.bk-starters .bk-btn').allInnerTexts()
      await shot(page, `starters${route === '/' ? '-month' : route.replace('/', '-')}`)
    }
    expect(shown['/']).toContain('How are we doing this month?')
    expect(shown['/trends']).toContain('How did the last six months go?')
    expect(new Set(Object.values(shown).map(s => s.join('|'))).size, JSON.stringify(shown)).toBe(4)
    await page.locator('.bk-starters .bk-btn', { hasText: 'How did the last six months go?' }).click()
    await expect(page.locator('.bk-me').last()).toHaveText('How did the last six months go?')
    await expect(page.locator('.bk-starters')).toHaveCount(0)
    await app.settled()
    expect(app.botValue("SELECT text FROM bot_messages WHERE role = 'user' ORDER BY id DESC LIMIT 1")).toEqual([['How did the last six months go?']])
  })

  test('a receipt photo is read into a card with its shop, amount and date; a voice note is heard first and never settles a card', async () => {
    await app.post('/chat/new', { channel: 'bubble' })
    await app.useRunner('claude-cli', 'sonnet')
    const before = app.dump()
    const afterPhoto = await app.upload('photo', 'receipt.png', readFileSync(path.join(assets, 'receipt-bakery.png')))
    expect(afterPhoto[0]).toMatchObject({ kind: 'photo', role: 'user', status: 'done' })
    const photoCard = afterPhoto.find((m: any) => m.card)?.card
    expect(photoCard, JSON.stringify(afterPhoto.map((m: any) => [m.kind, m.text]))).toBeTruthy()
    expect(photoCard.kind).toBe('transaction.add')
    expect(photoCard.lines[0]).toMatch(/^Add: .*Korenbloem.* · 11 Nov · -⁠€7,80, in /i)
    expect(app.dump(), 'nothing changes without Apply').toEqual(before)
    expect(app.botValue(`SELECT attachment IS NULL FROM bot_messages WHERE id = ${afterPhoto[0].id}`)).toEqual([[1]])

    await app.post('/chat/new', { channel: 'bubble' })
    const afterVoice = await app.upload('voice', 'voice.ogg', readFileSync(path.join(assets, 'voice-fifteen-euros-market.ogg')))
    const heard = afterVoice[0]
    expect(heard.kind).toBe('voice')
    expect(heard.text).toMatch(/^(15|fifteen) euros cash at the market\.?$/i)
    const voiceCard = afterVoice.find((m: any) => m.card)?.card
    expect(voiceCard?.kind).toBe('transaction.add')
    const todayLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    expect(voiceCard.lines[0]).toContain(`· ${todayLabel} · -⁠€15,00, in `)
    expect(voiceCard.status, 'words from a voice note never settle a card').toBe('open')
    expect(app.dump()).toEqual(before)

    const unclear = await app.upload('voice', 'voice.ogg', readFileSync(path.join(assets, 'voice-unclear.ogg')))
    expect(unclear.at(-1)).toMatchObject({ kind: 'error', text: 'I could not make that out. Could you say it again, or type it? Nothing changed.' })
    expect(app.dump()).toEqual(before)
  })
})
