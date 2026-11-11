/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, TelegramStub, ingCsv, ingRow, monthDates, openChat, say, seedHistory, shot, startBot, thread,
} from './fixtures'

// The finance agent in controlled conditions: a scripted Claude in the real sandbox makes real tool calls,
// through the real app, Telegram bot and browser. Behaviour that rests on Claude's judgement is in agent-real.
const app = new App({ port: 18721, fakeClaude: true })
const stub = new TelegramStub(18722)
const d = monthDates()
let stopBot: () => void
let page: Page

const answer = (text: string) => ({ kind: 'answer', text })
const query = (doing: string, ...queries: string[]) => ({ kind: 'query', doing, queries })
const overview = (doing: string, month?: string) => ({ kind: 'overview', doing, ...(month ? { month } : {}) })
const propose = (summary: string, op: string, args: object, text?: string) => ({ kind: 'propose', summary, op, args, ...(text ? { text } : {}) })
const bubble = async () => (await app.json('/chat/messages?channel=bubble')).messages
const telegram = async () => (await app.json('/chat/messages?channel=telegram')).messages
const idOf = async (name: string) => (await app.category(name)).id

/** Sends a message in the panel and waits for its reply to land. */
async function replyTo(text: string) {
  const after = (await bubble()).at(-1)?.id ?? 0
  await say(page, text)
  let replies: any[] = []
  await expect.poll(async () => {
    const messages = await bubble()
    const asked = messages.find((m: any) => m.role === 'user' && m.id > after && m.text === text)
    if (asked?.status !== 'done') return false
    replies = messages.filter((m: any) => m.reply_to === asked.id)
    return replies.length > 0
  }, { timeout: 60_000, intervals: [300] }).toBe(true)
  return replies
}

/** Waits for the Telegram message to be answered and returns what the app saved for it. */
async function telegramReply(text: string) {
  const after = (await telegram()).at(-1)?.id ?? 0
  stub.text(DANIEL, text)
  let replies: any[] = []
  await expect.poll(async () => {
    const messages = await telegram()
    const asked = messages.find((m: any) => m.role === 'user' && m.id > after && m.text === text)
    if (asked?.status !== 'done') return false
    replies = messages.filter((m: any) => m.reply_to === asked.id)
    return replies.length > 0 && replies.every((r: any) => r.card ? r.card.message_ids.length > 0 : true)
  }, { timeout: 60_000, intervals: [300] }).toBe(true)
  return replies
}

const lastPrompt = () => app.calls().at(-1)!.prompt
const conversationIn = (prompt: string) => JSON.parse(prompt.split('<conversation>\n')[1].split('\n</conversation>')[0])

/** Waiting guesses, as an import leaves them: bank rows with a guessed category, not yet reviewed. */
async function addGuesses(count: number, prefix: string) {
  const misc = await idOf('Miscellaneous')
  const values = Array.from({ length: count }, (_, i) =>
    `('${d.inMonth(i % 10)}', ${-(100 + i)}/100.0, '${prefix} ${i + 1} Amsterdam Centrum', 'ing', ${misc}, 0, 'ai', 0.6, '${prefix}-${i}', 0)`)
  app.sql(`INSERT INTO transactions (date, amount, description, source, category_id, confirmed, categorised_by, ai_confidence, import_hash, is_refund) VALUES ${values.join(',')}`)
  return (await app.transactions()).filter(t => t.description.startsWith(`${prefix} `))
}

test.describe.serial('the finance agent, in controlled conditions', () => {
  test.beforeAll(async ({ browser }) => {
    await app.start()
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await seedHistory(app, d)
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

  test.beforeEach(async () => {
    app.fake({ mode: 'reply', delay: '0', wrapup: 'I stopped early. So far I had found the scripted figures.' })
    await app.newChats()
    await page.reload()
    await openChat(page)
  })

  test('R-001: the whole conversation goes to the agent each time, until New chat, and each chat keeps its own', async () => {
    app.fakeReply(answer('Noted.'))
    await replyTo('Our holiday fund is called Sample Sunflower')
    for (let i = 1; i <= 24; i++) await app.post('/chat/messages', { channel: 'bubble', text: `Sample filler message ${i}` })
    await app.settled('bubble')
    await replyTo('What is the holiday fund called again?')
    const said = conversationIn(lastPrompt())
    expect(said.filter((e: any) => e.from === 'person')).toHaveLength(25)
    expect(lastPrompt()).toContain('<new_message>\n"What is the holiday fund called again?"')
    expect(said[0]).toEqual({ from: 'person', text: 'Our holiday fund is called Sample Sunflower' })
    expect(said.filter((e: any) => e.from === 'you')).toHaveLength(25)

    // Telegram is a conversation of its own.
    await telegramReply('Hello from Telegram')
    expect(lastPrompt()).not.toContain('Sample Sunflower')
    expect(conversationIn(lastPrompt())).toEqual([])
    await telegramReply('Second Telegram message')
    expect(conversationIn(lastPrompt()).map((e: any) => e.text)).toEqual(['Hello from Telegram', 'Noted.'])

    // /start, which Telegram sends when the bot is opened afresh, only says hello: the conversation carries on.
    const helloAt = stub.sent.length
    const callsBefore = app.calls().length
    stub.text(DANIEL, '/start')
    const hello = await stub.reply_after(helloAt, m => m.text.startsWith('Hello.'))
    expect(hello.text).toContain('/new')
    expect(app.calls(), '/start is not sent to Claude').toHaveLength(callsBefore)
    await telegramReply('Third Telegram message')
    expect(conversationIn(lastPrompt()).map((e: any) => e.text)).toEqual(['Hello from Telegram', 'Noted.', 'Second Telegram message', 'Noted.'])

    // New chat in the panel: the thread empties for everyone, and the agent no longer gets the earlier conversation.
    app.fakeReply(propose('Add Sample Old Card.', 'transaction.add', { date: d.today, amount_cents: -100, description: 'Sample Old Card', category_id: await idOf('Miscellaneous') }, 'Here it is.'))
    await replyTo('Add a sample old card')
    await page.reload()
    await openChat(page)
    await page.getByRole('button', { name: 'New chat' }).click()
    await expect(page.locator('.chat-confirm')).toContainText("won't draw on this conversation")
    await shot(page, 'agent-new-chat-confirm')
    await page.getByRole('button', { name: 'Start new chat' }).click()
    await expect(thread(page).locator(':scope > li:not([aria-hidden])')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'How are we doing this month?' })).toBeVisible()
    const old = (await app.json('/chat/messages?channel=bubble')).messages
    expect(old).toEqual([])
    app.fakeReply(answer('Fresh start.'))
    await replyTo('yes')
    expect(conversationIn(lastPrompt())).toEqual([])
    expect(lastPrompt()).not.toContain('Sample Sunflower')
    expect((await app.transactions()).some(t => t.description === 'Sample Old Card'), 'a yes after New chat applied an old card').toBe(false)

    // /new in Telegram does the same there, and the panel is untouched by it.
    await replyTo('Panel message after the fresh start')
    const count = stub.sent.length
    stub.text(DANIEL, '/new')
    await stub.reply_after(count, m => m.text.includes('Started a new chat'))
    await telegramReply('After new in Telegram')
    expect(conversationIn(lastPrompt())).toEqual([])
    expect((await bubble()).map((m: any) => m.text)).toContain('Panel message after the fresh start')
  })

  test('R-003: one reply can take several lookups of any kind, and no lookup changes anything', async () => {
    const before = app.dump()
    const goalsBefore = await app.json('/goals')
    app.script([
      { reply: overview('Checking how this month stands') },
      { reply: overview('Checking a month long ago', d.back(30)) },
      { reply: query('Looking at the last six months', `SELECT month, category, spent_cents FROM category_months WHERE month >= '${d.back(6)}'`, 'SELECT * FROM month_totals') },
      { reply: query('Checking plans, rules and goals', 'SELECT * FROM budgets', 'SELECT * FROM rules', 'SELECT * FROM savings_goals') },
      { reply: query('Checking categories and standing amounts', 'SELECT * FROM categories', 'SELECT * FROM standing_adjustments', "SELECT id, description, category_id FROM transactions WHERE confirmed = 0") },
      { reply: answer('Here is everything in one reply.') },
    ])
    const replies = await replyTo('Tell me everything')
    expect(replies.map((r: any) => r.text)).toEqual(['Here is everything in one reply.'])
    const calls = app.toolCalls()
    expect(calls.map(c => c.tool)).toEqual(['month_overview', 'month_overview', 'run_query', 'run_query', 'run_query'])
    expect(calls.every(c => !c.isError)).toBe(true)
    expect(app.calls(), 'all of it in one run of Claude').toHaveLength(1)
    const results = app.queryResults()
    expect(results).toHaveLength(8)
    const asked = (await bubble()).find((m: any) => m.role === 'user' && m.text === 'Tell me everything')
    expect(asked.payload.lookups, 'two overviews and eight queries, in five steps').toBe(10)
    for (const r of results) expect(r.error, r.id).toBeUndefined()
    expect(results.find(r => r.columns.includes('pattern')).rows.length).toBeGreaterThan(0)
    expect(app.dump(), 'a lookup changed the data').toEqual(before)
    expect(await app.json('/goals')).toEqual(goalsBefore)
  })

  test('R-005 R-012: every kind of change, savings goals included, waits for Apply; Not this or silence change nothing; a double tap applies once', async () => {
    const shop = (await app.transactions()).find(t => t.description === 'Albert Heijn 1234' && t.amount_cents === -1100)!
    const holiday = await app.post('/categories', { name: 'Sample Holiday Pot', type: 'savings' })
    await app.json(`/budget?month=${d.label}`) // the Month page fills in the new category's plan on its next refresh
    app.script([
      { reply: propose('Move today\'s Albert Heijn payment to Eating out.', 'transaction.update', { id: shop.id, category_id: await idOf('Food - Not Essential') }) },
      { reply: propose('Plan €80,00 for Clothing from now on.', 'budget.set', { category_id: await idOf('Clothing'), month: null, planned_amount_cents: 8000 }) },
      { reply: propose('Sort Sample Florist as Home & DIY.', 'rule.add', { pattern: 'sample florist', category_id: await idOf('Home & DIY') }) },
      { reply: propose('Save €1.500,00 for a holiday by next summer.', 'goal.set', { category_id: holiday.id, name: 'Holiday', target_cents: 150000, by: d.back(-8) }) },
      { reply: answer('Four cards, one for each. Nothing changes until you press Apply.') },
    ])
    const before = app.dump()
    const replies = await replyTo('Move the bakery, plan 80 for clothes, add a florist rule and start a holiday goal')
    expect(replies.filter((r: any) => r.card).map((r: any) => r.card.status)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(replies.at(-1).text).toContain('Nothing changes until you press Apply')
    expect(app.dump(), 'a card changed something before Apply').toEqual(before)
    const cards = page.locator('.chat-card[data-state="pending"]')
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(3)).toContainText('Savings goal “Holiday”')
    await expect(cards.nth(3)).toContainText('€1.500,00')
    await shot(page, 'agent-four-cards')

    // Not this changes nothing.
    await cards.nth(0).getByRole('button', { name: 'Not this' }).click()
    await expect(page.locator('[data-state="rejected"]')).toHaveCount(1)
    expect(app.dump()).toEqual(before)

    // A double tap applies once.
    const [budgetCard, ruleCard, goalCard] = replies.filter((r: any) => r.card).slice(1).map((r: any) => r.card)
    const taps = await Promise.all([1, 2, 3].map(() => app.post(`/chat/proposals/${ruleCard.id}/apply`, { version: ruleCard.version })))
    expect(taps.every(t => t.status === 'applied')).toBe(true)
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern === 'sample florist')).toHaveLength(1)
    await Promise.all([1, 2].map(() => app.post(`/chat/proposals/${goalCard.id}/apply`, { version: goalCard.version })))
    const goals = (await app.json('/goals')).goals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ name: 'Holiday', target_cents: 150000, category_id: holiday.id })

    // Silence: the budget card was never answered, and the plans did not move.
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(app.dump().budgets).toEqual(before.budgets)
    expect((await bubble()).find((m: any) => m.card?.id === budgetCard.id).card.status).toBe('pending')
    expect((await app.transactions()).find(t => t.id === shop.id).category_name).not.toBe('Food - Not Essential')
  })

  test('R-005: a typed yes or no still answers the one card in front of it, even with the agent\'s words after it', async () => {
    const addCard = async (description: string) => propose(`Add ${description}.`, 'transaction.add',
      { date: d.today, amount_cents: -1234, description, category_id: await idOf('Miscellaneous') }, 'Here is the card. Apply adds it.')
    app.fakeReply(await addCard('Sample Typed Yes'))
    const replies = await replyTo('Add the typed yes payment')
    expect(replies.map((r: any) => r.kind)).toEqual(['proposal', 'answer'])
    await expect(page.locator('.chat-reply', { hasText: 'Here is the card. Apply adds it.' })).toBeVisible()
    await expect(page.locator('.chat-card[data-state="pending"]')).toHaveCount(1)
    const calls = app.calls().length
    await say(page, 'yes')
    await expect(page.locator('[data-state="applied"]')).toHaveCount(1)
    expect((await app.transactions()).filter(t => t.description === 'Sample Typed Yes')).toHaveLength(1)
    expect(app.calls().length, 'the yes went to Claude').toBe(calls)

    app.fakeReply(await addCard('Sample Typed No'))
    await telegramReply('Add the typed no payment')
    const count = stub.sent.length
    stub.text(DANIEL, 'no')
    await stub.reply_after(0, m => m.text.startsWith('Not applied'))
    expect(stub.sent.length).toBe(count)
    expect((await app.transactions()).some(t => t.description === 'Sample Typed No')).toBe(false)
  })

  test('R-005 R-008: earlier cards stay open; a correction replaces only the card it names', async () => {
    const add = async (description: string, extra: object = {}) => ({ ...propose(`Add ${description}.`, 'transaction.add',
      { date: d.today, amount_cents: -321, description, category_id: await idOf('Miscellaneous') }), ...extra })
    app.fakeReply(await add('Sample Keep One'))
    const [first] = await replyTo('Add keep one')
    app.fakeReply(await add('Sample Keep Two'))
    const [second] = await replyTo('Add keep two')
    expect((await bubble()).find((m: any) => m.id === first.id).card.status).toBe('pending')
    app.fakeReply(await add('Sample Keep Two Corrected', { replaces: [second.card.id] }))
    await replyTo('No, call it corrected')
    const cards = Object.fromEntries((await bubble()).filter((m: any) => m.card).map((m: any) => [m.card.summary, m.card.status]))
    expect(cards).toEqual({ 'Add Sample Keep One.': 'pending', 'Add Sample Keep Two.': 'superseded', 'Add Sample Keep Two Corrected.': 'pending' })
    // With more than one card open, a typed yes answers only the one made since the person last spoke.
    await expect(page.locator('.chat-card[data-state="pending"]', { hasText: 'Sample Keep Two Corrected' })).toBeVisible()
    await expect(page.locator('[data-state="superseded"]')).toHaveCount(1)
    await expect(page.locator('.chat-card[data-state="pending"]')).toHaveCount(2)
    await say(page, 'yes')
    await expect(page.locator('[data-state="applied"]')).toHaveCount(1)
    const rows = (await app.transactions()).map(t => t.description)
    expect(rows).toContain('Sample Keep Two Corrected')
    expect(rows).not.toContain('Sample Keep One')
  })

  test('R-006: one card holds 85 guesses, readable in both chats, split over Telegram messages with the buttons last, and Apply confirms all 85', async () => {
    const guesses = await addGuesses(85, 'Sample Batch Shop Number')
    const step = propose('Accept these 85 guesses as they stand.', 'review.confirm', { ids: guesses.map(g => g.id) }, 'One card for all 85.')
    app.fakeReply(step)
    await replyTo('Confirm the 85 batch guesses')
    const card = page.locator('.chat-card[data-state="pending"]').last()
    await expect(card).toContainText('85 rows')
    await expect(card.locator('.chat-batch > li')).toHaveCount(8)
    await card.getByRole('button', { name: 'Show all 85' }).click()
    await expect(card.locator('.chat-batch > li')).toHaveCount(85)
    await expect(card.locator('.chat-batch > li').first()).toContainText('Reviewed: No → Yes')
    await shot(page, 'agent-batch-85-desktop')
    await card.getByRole('button', { name: 'Show fewer' }).click()

    app.fakeReply(step)
    const count = stub.sent.length
    const [cardReply] = await telegramReply('Confirm the 85 batch guesses in Telegram')
    const parts = stub.sent.slice(count).filter(m => cardReply.card.message_ids.includes(m.message_id))
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.text.length).toBeLessThanOrEqual(4096)
    const keyed = parts.filter(m => (m.reply_markup?.inline_keyboard ?? []).length > 0)
    expect(keyed).toEqual([parts.at(-1)])
    const all = parts.map(m => m.text).join('\n')
    for (const g of guesses) expect(all).toContain(g.description)
    expect(all.split('\n').filter(line => line.startsWith('• '))).toHaveLength(85)

    stub.tap(DANIEL, parts.at(-1)!, stub.button(parts.at(-1)!, 'Apply'))
    await expect.poll(() => parts[0].text, { timeout: 20_000 }).toMatch(/^Applied/)
    expect(parts.slice(1).every(m => m.deleted)).toBe(true)
    const after = (await app.transactions()).filter(t => t.description.startsWith('Sample Batch Shop Number '))
    expect(after.filter(t => t.confirmed)).toHaveLength(85)
    // The panel's own card for the same rows cannot apply anything a second time.
    await page.locator('.chat-card[data-state="pending"]').last().getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('[data-state="failed"], [data-state="pending"]').last()).toBeVisible()
    expect((await app.transactions()).filter(t => t.description.startsWith('Sample Batch Shop Number ') && t.confirmed)).toHaveLength(85)
  })

  test('R-007: when the app turns part of a card down, the agent is told why and the person only sees the corrected card', async () => {
    const guesses = await addGuesses(3, 'Sample Fix Shop')
    const manual = (await app.transactions()).find(t => t.source === 'manual' && t.standing_adjustment_id === null)
      ?? await app.addManual(d.inMonth(2), -999, 'Sample Manual McD', 'Food - Not Essential')
    app.script([
      { reply: propose('Accept these four guesses.', 'review.confirm', { ids: [...guesses.map(g => g.id), manual.id] }) },
      { reply: propose('Accept these three guesses.', 'review.confirm', { ids: guesses.map(g => g.id) }) },
      { reply: answer('Three guesses on the card. The manual entry was not a guess, so I left it off.') },
    ])
    const replies = await replyTo('Review the fix shop guesses')
    const [refused, accepted] = app.toolCalls()
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain(`Row ${manual.id}`)
    expect(refused.text).toContain('is not a guess waiting for review')
    expect(accepted.isError).toBe(false)
    expect(replies.map((r: any) => r.kind)).toEqual(['proposal', 'answer'])
    expect(replies.some((r: any) => r.kind === 'error')).toBe(false)
    const card = replies[0].card
    expect(card.changes).toHaveLength(3)
    expect(card.changes.map((c: any) => c.title).join()).not.toContain(manual.description)
    const steps = (await bubble()).find((m: any) => m.text === 'Review the fix shop guesses').payload.steps
    expect(steps).toContain('The app would not take that as it was, so I am correcting it')

    // A change that truly cannot be made ends in the agent's own plain explanation, not an app error.
    const bank = (await app.transactions()).find(t => t.source === 'ing')!
    app.script([
      { reply: propose('Delete the bank row.', 'transaction.delete', { id: bank.id }) },
      { reply: answer('I can\'t delete that one: it came from the bank file, and only manual entries can be deleted.') },
    ])
    const plain = await replyTo('Delete that bank row')
    expect(app.toolCalls()[0].isError).toBe(true)
    expect(plain.map((r: any) => r.kind)).toEqual(['answer'])
    expect((await app.transactions()).some(t => t.id === bank.id)).toBe(true)
  })

  test('R-009: each step shows live in both chats within seconds, in plain words, as one Telegram message that keeps updating', async () => {
    const steps = () => [
      { reply: overview('Checking how this month stands'), delay: 3 },
      { reply: query('SELECT * FROM transactions WHERE amount_cents < 0', 'SELECT 1 AS one_count'), delay: 3 },
      { reply: query('Comparing groceries with last month', 'SELECT 2 AS two_count'), delay: 3 },
      { reply: answer('Done looking.'), delay: 3 },
    ]
    app.script(steps())
    const started = Date.now()
    await say(page, 'Walk me through it')
    const log = page.getByTestId('chat-steps')
    await expect(log.locator('li')).toHaveCount(1, { timeout: 8_000 })
    const first = Date.now() - started
    await expect(log).toContainText('Checking how this month stands')
    await shot(page, 'agent-live-log-desktop')
    await expect(log.locator('li')).toHaveCount(2, { timeout: 6_000 })
    await expect(log.locator('li').nth(1)).toHaveText('Looking through the history')
    await expect(log.locator('li')).toHaveCount(3, { timeout: 6_000 })
    expect(first).toBeLessThan(3_000 + 4_000) // its call starts after 3 seconds; it shows within a few more
    await expect(page.locator('.chat-reply', { hasText: 'Done looking.' })).toBeVisible()
    const done = page.locator('.chat-log-done').last()
    await expect(done).toContainText('Worked through · 3 steps')

    // Telegram: one log message, edited as the steps come in, never showing query text.
    app.script(steps())
    const count = stub.sent.length
    stub.text(DANIEL, 'Walk me through it in Telegram')
    const logMessage = await stub.reply_after(count, m => m.text.startsWith('Working on it'))
    expect(stub.button(logMessage, 'Stop')).toBe('s:0')
    await expect.poll(() => logMessage.text, { timeout: 8_000 }).toContain('• Checking how this month stands')
    await expect.poll(() => logMessage.text, { timeout: 8_000 }).toContain('• Looking through the history')
    await stub.reply_after(count, m => m.text === 'Done looking.')
    await expect.poll(() => logMessage.text, { timeout: 8_000 }).toMatch(/^Worked through:/)
    expect(logMessage.reply_markup?.inline_keyboard ?? []).toEqual([])
    const fresh = stub.sent.slice(count)
    expect(fresh.filter(m => m.text.startsWith('Working on it') || m.edits.some(e => e.startsWith('Working on it')))).toHaveLength(1)
    expect(logMessage.edits.length).toBeGreaterThanOrEqual(3)
    for (const text of [...fresh.map(m => m.text), ...fresh.flatMap(m => m.edits)]) expect(text).not.toMatch(/SELECT|FROM transactions|_count/)
  })

  test('R-010: Stop in the panel ends the reply within seconds, says what was found, changes nothing and leaves earlier cards', async () => {
    app.fakeReply(propose('Add Sample Earlier Card.', 'transaction.add', { date: d.today, amount_cents: -500, description: 'Sample Earlier Card', category_id: await idOf('Miscellaneous') }))
    const [earlier] = await replyTo('Make the earlier card')
    const before = app.dump()
    app.script([{ reply: query('Checking the bakery spending', "SELECT SUM(amount_cents) AS bakery_cents FROM transactions WHERE merchant LIKE 'sample bakery%'"), repeat: true, delay: 1 }])
    await say(page, 'Keep digging for ever')
    await expect(page.getByTestId('chat-steps').locator('li').first()).toBeVisible({ timeout: 8_000 })
    await shot(page, 'agent-stop-button')
    const pressed = Date.now()
    await page.getByTestId('chat-pending').getByRole('button', { name: 'Stop' }).click()
    await expect(page.locator('.chat-reply', { hasText: 'I stopped early. So far I had found the scripted figures.' })).toBeVisible({ timeout: 15_000 })
    expect(Date.now() - pressed).toBeLessThan(8_000)
    await expect(page.locator('.chat-log-done').last()).toContainText('Stopped')
    const wrapUp = app.calls().at(-1)!
    expect(wrapUp.argv).not.toContain('--mcp-config')
    expect(wrapUp.prompt).toContain('<work_so_far>')
    expect(wrapUp.prompt).toContain('bakery_cents')
    expect(wrapUp.prompt).toContain('The person pressed Stop')
    expect(app.dump()).toEqual(before)
    expect((await bubble()).find((m: any) => m.id === earlier.id).card.status).toBe('pending')

    // Stopped before it found anything: said at once, without asking Claude again.
    app.script([{ reply: query('Never gets here', 'SELECT 1 AS n_count'), delay: 60 }])
    await say(page, 'Think for a long time')
    await expect(page.getByTestId('chat-pending').getByRole('button', { name: 'Stop' })).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    await page.getByTestId('chat-pending').getByRole('button', { name: 'Stop' }).click()
    await expect(page.locator('.chat-reply').last()).toHaveText('Stopped. I had not found anything yet, so I have nothing to add, and nothing changed.', { timeout: 8_000 })
  })

  test('R-001 R-010: New chat while a reply is being worked on ends it without a write-up, and the next message is answered', async () => {
    app.script([{ reply: query('Checking the bakery spending', "SELECT SUM(amount_cents) AS bakery_cents FROM transactions WHERE merchant LIKE 'sample bakery%'"), repeat: true, delay: 1 }])
    await say(page, 'Dig until a new chat')
    await expect(page.getByTestId('chat-steps').locator('li').first()).toBeVisible({ timeout: 8_000 })
    const callsBefore = app.calls().length
    await page.getByRole('button', { name: 'New chat' }).click()
    await page.getByRole('button', { name: 'Start new chat' }).click()
    app.fakeReply(answer('A fresh answer.'))
    const replies = await replyTo('First question of the new chat')
    expect(replies.map((r: any) => r.text)).toEqual(['A fresh answer.'])
    const since = app.calls().slice(callsBefore)
    expect(since.filter(c => c.prompt.includes('<work_so_far>')), 'no write-up for a reply nobody will see').toEqual([])
    expect(since.at(-1)!.prompt).not.toContain('Dig until a new chat')
    expect((await bubble()).map((m: any) => m.text)).toEqual(['First question of the new chat', 'A fresh answer.'])
  })

  for (const how of ['the Stop button', 'typing stop', 'typing /stop'] as const) {
    test(`R-010: in Telegram, ${how} ends the reply and says what was found`, async () => {
      app.script([{ reply: query('Checking the gym payments', "SELECT COUNT(*) AS gym_count FROM transactions WHERE merchant LIKE 'sample gym%'"), repeat: true, delay: 1 }])
      const count = stub.sent.length
      stub.text(DANIEL, `Dig forever, then ${how}`)
      const log = await stub.reply_after(count, m => m.text.startsWith('Working on it'))
      await expect.poll(() => log.text, { timeout: 8_000 }).toContain('Checking the gym payments')
      const pressed = Date.now()
      if (how === 'the Stop button') stub.tap(DANIEL, log, stub.button(log, 'Stop'))
      else stub.text(DANIEL, how === 'typing stop' ? 'Stop' : '/stop')
      await stub.reply_after(count, m => m.text === 'I stopped early. So far I had found the scripted figures.')
      expect(Date.now() - pressed).toBeLessThan(8_000)
      await expect.poll(() => log.text, { timeout: 8_000 }).toMatch(/^Stopped\./)
      const asked = (await telegram()).filter((m: any) => m.role === 'user')
      expect(asked.map((m: any) => m.text)).not.toContain('Stop')
      expect(asked.map((m: any) => m.text)).not.toContain('/stop')
      expect(asked.at(-1).payload.ended).toBe('stopped')
    })
  }

  test('R-010: stop with nothing being worked on says so, and the panel\'s Stop leaves Telegram\'s reply alone', async () => {
    const count = stub.sent.length
    stub.text(DANIEL, '/stop')
    await stub.reply_after(count, m => m.text === 'Nothing is being worked on right now.')

    app.script([{ reply: query('Checking something slowly', 'SELECT 1 AS one_count'), delay: 3 }, { reply: answer('Telegram finished its own reply.') }])
    stub.text(DANIEL, 'A slow Telegram question')
    await stub.reply_after(count, m => m.text.startsWith('Working on it'))
    expect((await app.post('/chat/stop', { channel: 'bubble' })).stopped).toBe(0)
    await stub.reply_after(count, m => m.text === 'Telegram finished its own reply.')
  })

  test('R-012: the agent gets only the app\'s tools: no built-in tools, files, shell or internet, no outside servers, no key', async () => {
    app.fakeReply(answer('Checked.'))
    await replyTo('What can you use?')
    const call = app.lastCall()
    const argv: string[] = call.argv
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(argv).toContain('--disable-slash-commands')
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('')
    expect(argv[argv.indexOf('--allowedTools') + 1].split(',').sort()).toEqual([
      'mcp__finance__month_overview', 'mcp__finance__propose_change', 'mcp__finance__run_query',
      'mcp__finance__show_chart', 'mcp__finance__show_choices',
    ])
    expect(call.env.some((name: string) => /ANTHROPIC|API_KEY/i.test(name))).toBe(false)
    expect(call.home).toEqual([])
    expect(call.real_login_visible).toBe(false)
  })

  test('R-013: a chart drawn by the app from the agent\'s lookup reaches both chats, with the numbers of that lookup', async () => {
    const sql = `SELECT month, category, spent_cents FROM category_months WHERE month >= '${d.back(6)}' AND month < '${d.label}' AND category IN ('Food - Essential', 'Food - Not Essential', 'Recreation & Entertainment')`
    const steps = [
      { reply: query('Looking at spending per category over six months', sql) },
      { reply: { kind: 'chart', query: 'q1', type: 'bars', x: 'month', y: 'spent_cents', series: 'category', title: 'Spending per category' } },
      { reply: answer('Groceries were the biggest each month.') },
    ]
    app.script(steps)
    const replies = await replyTo('Show spend per category over 6 months')
    const [result] = app.queryResults()
    const chart = replies.at(-1).payload.chart
    expect(chart.labels).toEqual([...new Set(result.rows.map((r: any) => r[0]))].sort())
    for (const series of chart.series) {
      for (const [i, label] of chart.labels.entries()) {
        const row = result.rows.find((r: any) => r[0] === label && r[1] === series.name)
        expect(series.values[i], `${series.name} ${label}`).toBe(row ? row[2] : 0)
      }
    }
    const picture = page.locator('img.chat-chart:visible')
    await expect(picture).toHaveCount(1)
    expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(500)
    await shot(page, 'agent-chart-desktop')

    app.script(steps)
    const photos = stub.photos.length
    await telegramReply('Show spend per category over 6 months')
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    expect(stub.photos.at(-1)!.body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
  })

  test('R-014: a file sent to the agent still imports and summarises as before, without Claude answering it', async () => {
    const calls = app.calls().length
    await page.getByTestId('chat-file').setInputFiles({ name: 'ing.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow(d.inMonth(3), 'Sample Agent Import', -4200)])) })
    const card = page.locator('.chat-card', { hasText: 'ING import' }).last()
    await expect(card).toContainText('New1')
    expect(app.calls().slice(calls).some(c => c.argv.includes('--mcp-config'))).toBe(false)
  })
})

test.describe.serial('the finance agent at its time limit', () => {
  const limited = new App({ port: 18723, fakeClaude: true, env: { CHAT_TIME_LIMIT_SECONDS: '12' } })
  const limitedStub = new TelegramStub(18724)
  let stopLimitedBot: () => void

  test.beforeAll(async () => {
    await limited.start()
    await limitedStub.start()
    stopLimitedBot = startBot(limitedStub, `${limited.base}/api`)
  })

  test.afterAll(async () => {
    stopLimitedBot()
    await limitedStub.stop()
    await limited.stop()
    limited.destroy()
  })

  test('R-011: at the limit the agent gives what it has and says it stopped early; a message sent meanwhile waits with the note', async () => {
    limited.fake({ wrapup: 'Here is what I had: the scripted figures.' })
    limited.script([{ reply: query('Checking every month', 'SELECT 1 AS one_count'), repeat: true, delay: 1 }])
    const started = Date.now()
    await limited.post('/chat/messages', { channel: 'bubble', text: 'Dig until the limit' })
    await new Promise(resolve => setTimeout(resolve, 2000))
    const count = limitedStub.sent.length
    limitedStub.text(DANIEL, 'Waiting behind the long one')
    await limitedStub.reply_after(count, m => m.text.startsWith('Waiting for Claude'))
    await limited.settled('bubble')
    const took = (Date.now() - started) / 1000
    expect(took).toBeGreaterThan(11)
    expect(took).toBeLessThan(30)
    const messages = (await limited.json('/chat/messages?channel=bubble')).messages
    expect(messages.at(-1).text).toBe('I stopped early, so this is partial.\n\nHere is what I had: the scripted figures.')
    expect(messages[0].payload.ended).toBe('time')
    expect(limited.calls().some(c => c.prompt.includes('You reached the time limit'))).toBe(true)
    // The waiting Telegram message is answered once the long reply is over.
    await limited.settled('telegram')
  })
})

// Ten real minutes: run with E2E_FULL_LIMIT=1 to check the limit as configured for use, not a shortened one.
test.describe.serial('the finance agent at its real time limit', () => {
  test.skip(!process.env.E2E_FULL_LIMIT, 'takes ten minutes; set E2E_FULL_LIMIT=1')
  const full = new App({ port: 18725, fakeClaude: true })

  test.beforeAll(async () => { await full.start() })
  test.afterAll(async () => { await full.stop(); full.destroy() })

  test('R-011: one reply ends at about ten minutes, saying it stopped early', async () => {
    test.setTimeout(900_000)
    full.fake({ wrapup: 'Here is what I had: the scripted figures.' })
    full.script([{ reply: query('Checking every month', 'SELECT 1 AS one_count'), repeat: true, delay: 2 }])
    const started = Date.now()
    await full.post('/chat/messages', { channel: 'bubble', text: 'Dig for as long as you may' })
    await expect.poll(async () => (await full.json('/chat/messages?channel=bubble')).messages.at(-1).role,
      { timeout: 800_000, intervals: [2000] }).toBe('assistant')
    const minutes = (Date.now() - started) / 60_000
    test.info().annotations.push({ type: 'took', description: `${minutes.toFixed(2)} minutes` })
    expect(minutes).toBeGreaterThan(8.9)
    expect(minutes).toBeLessThan(10.5)
    expect((await full.json('/chat/messages?channel=bubble')).messages.at(-1).text).toContain('I stopped early')
  })
})
