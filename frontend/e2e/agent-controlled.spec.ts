/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, TelegramStub, ingCsv, ingRow, monthDates, openChat, port, say, script, seedHistory, shot, startBot, thread,
} from './fixtures'

// The finance agent in controlled conditions: botkit's scripted model ("Test script") makes real tool calls, through
// the real app, the real Telegram front (botkit.telegram, backend/telegram_bot.py) and the browser. Each message
// carries its own SCRIPT-* lines (SPEC §12): SCRIPT-TOOL calls a tool, SCRIPT-SAY is the reply, SCRIPT-SLOW waits
// between steps, SCRIPT-ECHO replies with the whole prompt the model was given. Behaviour that rests on Claude's
// judgement is in agent-real. The import sorter is a stand-in steered with app.fake().
const app = new App({ port: port(0), fakeClaude: true })
const stub = new TelegramStub(port(1))
const d = monthDates()
let stopBot: () => void
let page: Page

const SAY = (text: string) => text.split('\n').map(line => `SCRIPT-SAY ${line}`).join('\n')
const noted = (text: string) => `${text}\nSCRIPT-SAY Noted.`
const echo = (text: string) => `${text}\nSCRIPT-ECHO`
const overview = (doing: string, month?: string) => ['month_overview', { doing, ...(month ? { month } : {}) }] as [string, object]
const query = (doing: string, ...queries: string[]) => ['run_query', { doing, queries }] as [string, object]
const change = (summary: string, kind: string, args: object, extra: object = {}) => ['make_change', { kind, summary, args, ...extra }] as [string, object]
/** A lookup that is slow enough to stop: `times` steps, a second apart. */
const digging = (doing: string, sql: string, times = 60, slow = 1) =>
  script(`SCRIPT-SLOW ${slow}`, ...Array.from({ length: times }, () => query(doing, sql)), 'SCRIPT-SAY Never said.')
const BAKERY = "SELECT SUM(spend_cents) AS bakery_cents FROM spending WHERE merchant LIKE 'sample bakery%'"
const bubble = async () => (await app.conversation('bubble')).messages
const telegram = async () => (await app.conversation('telegram')).messages
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

/** Waits for the Telegram message to be answered and shown in the group, and returns what the app saved for it. */
async function telegramReply(text: string) {
  const after = (await telegram()).at(-1)?.id ?? 0
  stub.text(DANIEL, text)
  let replies: any[] = []
  await expect.poll(async () => {
    const messages = await telegram()
    const asked = messages.find((m: any) => m.role === 'user' && m.id > after && m.text === text)
    if (asked?.status !== 'done') return false
    replies = messages.filter((m: any) => m.reply_to === asked.id)
    return replies.length > 0 && replies.every((r: any) => (r.delivered ?? []).length > 0)
  }, { timeout: 60_000, intervals: [300] }).toBe(true)
  return replies
}

/** The <conversation> of a prompt the model was given (a SCRIPT-ECHO reply is the prompt itself). */
const conversationIn = (prompt: string) => JSON.parse(prompt.split('<conversation>\n')[1].split('\n</conversation>')[0])
const newMessageIn = (prompt: string) => JSON.parse(prompt.split('<new_message>\n')[1].split('\n</new_message>')[0])

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
    await app.useRunner('script', 'script', 'bubble')
    await app.useRunner('script', 'script', 'telegram')
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
    app.fake({ mode: 'reply', delay: '0' })
    await app.newChats()
    await page.reload()
    await openChat(page)
  })

  test('R-001: the whole conversation goes to the agent each time, until New chat, and each chat keeps its own', async () => {
    await replyTo(noted('Our holiday fund is called Sample Sunflower'))
    for (let i = 1; i <= 24; i++) await app.post('/chat/messages', { channel: 'bubble', text: noted(`Sample filler message ${i}`) })
    await app.settled('bubble')
    const [echoed] = await replyTo(echo('What is the holiday fund called again?'))
    const said = conversationIn(echoed.text)
    expect(said.filter((e: any) => e.from === 'person')).toHaveLength(25)
    expect(newMessageIn(echoed.text).text).toBe(echo('What is the holiday fund called again?'))
    expect(said[0]).toEqual({ from: 'person', text: noted('Our holiday fund is called Sample Sunflower') })
    expect(said.filter((e: any) => e.from === 'you')).toHaveLength(25)

    // Telegram is a conversation of its own.
    const [first] = await telegramReply(echo('Hello from Telegram'))
    expect(first.text).not.toContain('Sample Sunflower')
    expect(conversationIn(first.text)).toEqual([])
    const [second] = await telegramReply(echo('Second Telegram message'))
    expect(conversationIn(second.text).map((e: any) => e.text)).toEqual([echo('Hello from Telegram'), first.text])

    // /start, which Telegram sends when the bot is opened afresh, only says hello: the conversation carries on.
    const helloAt = stub.sent.length
    const messagesBefore = (await telegram()).length
    stub.text(DANIEL, '/start')
    const hello = await stub.reply_after(helloAt, m => m.text.startsWith('Hello.'))
    expect(hello.text).toContain('/new')
    expect(await telegram(), '/start is not sent to the agent').toHaveLength(messagesBefore)
    const [third] = await telegramReply(echo('Third Telegram message'))
    expect(conversationIn(third.text).map((e: any) => e.text)).toEqual([echo('Hello from Telegram'), first.text, echo('Second Telegram message'), second.text])

    // New chat in the panel: the thread empties for everyone, and the agent no longer gets the earlier conversation.
    await replyTo(script(change('Add Sample Old Card.', 'transaction.add', { date: d.today, amount_cents: -100, description: 'Sample Old Card', category_id: await idOf('Miscellaneous') }), 'SCRIPT-SAY Here it is.'))
    await page.reload()
    await openChat(page)
    await page.getByRole('button', { name: 'New chat' }).click()
    await expect(page.locator('.bk-confirm')).toContainText("won't draw on this conversation")
    await shot(page, 'agent-new-chat-confirm')
    await page.getByRole('button', { name: 'Start new chat' }).click()
    await expect(thread(page).locator(':scope > li:not([aria-hidden])')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'How are we doing this month?' })).toBeVisible()
    expect(await bubble()).toEqual([])
    await replyTo('yes')
    expect((await app.transactions()).some(t => t.description === 'Sample Old Card'), 'a yes after New chat applied an old card').toBe(false)
    const [fresh] = await replyTo(echo('What do you know so far?'))
    expect(conversationIn(fresh.text).map((e: any) => e.text)).toEqual(['yes', 'The script ran no tools.'])
    expect(fresh.text).not.toContain('Sample Sunflower')

    // /new in Telegram does the same there, and the panel is untouched by it.
    await replyTo(noted('Panel message after the fresh start'))
    const count = stub.sent.length
    stub.text(DANIEL, '/new')
    await stub.reply_after(count, m => m.text.includes('Started a new chat'))
    const [afterNew] = await telegramReply(echo('After new in Telegram'))
    expect(conversationIn(afterNew.text)).toEqual([])
    expect((await bubble()).map((m: any) => m.text)).toContain(noted('Panel message after the fresh start'))
  })

  test('R-003: one reply can take several lookups of any kind, and no lookup changes anything', async () => {
    const before = app.dump()
    const goalsBefore = await app.json('/goals')
    // No SCRIPT-SAY: the reply then lists each tool call and whether it failed.
    const text = script(
      overview('Checking how this month stands'),
      overview('Checking a month long ago', d.back(30)),
      query('Looking at the last six months', `SELECT month, category, spent_cents FROM category_months WHERE month >= '${d.back(6)}'`, 'SELECT * FROM month_totals'),
      query('Checking plans, rules and goals', 'SELECT * FROM budgets', 'SELECT * FROM rules', 'SELECT * FROM savings_goals'),
      query('Checking categories and standing amounts', 'SELECT * FROM categories', 'SELECT * FROM set_asides', 'SELECT id, description, category_id FROM transactions WHERE confirmed = 0'),
    )
    const replies = await replyTo(text)
    expect(replies, 'all of it in one reply').toHaveLength(1)
    const lines = replies[0].text.split('\n')
    expect(lines.map((l: string) => l.split(':')[0])).toEqual(['- month_overview', '- month_overview', '- run_query', '- run_query', '- run_query'])
    expect(replies[0].text, 'no lookup failed').not.toContain('(error)')
    expect(replies[0].text).not.toMatch(/"error"/)
    const asked = (await bubble()).find((m: any) => m.role === 'user' && m.text === text)
    expect(asked.steps, 'five steps in the live log').toEqual([
      'Checking how this month stands', 'Checking a month long ago', 'Looking at the last six months',
      'Checking plans, rules and goals', 'Checking categories and standing amounts',
    ])
    expect(app.dump(), 'a lookup changed the data').toEqual(before)
    expect(await app.json('/goals')).toEqual(goalsBefore)
  })

  test('R-005 R-012: every kind of change, savings goals included, waits for Apply; Not this or silence change nothing; a double tap applies once', async () => {
    const shop = (await app.transactions()).find(t => t.description === 'Albert Heijn 1234' && t.amount_cents === -1100)!
    const holiday = await app.post('/categories', { name: 'Sample Holiday Pot', type: 'savings' })
    await app.json(`/budget?month=${d.label}`) // the Month page fills in the new category's plan on its next refresh
    const text = script(
      change('Move today\'s Albert Heijn payment to Eating out.', 'transaction.update', { id: shop.id, category_id: await idOf('Food - Not Essential') }),
      change('Plan €80,00 for Clothing from now on.', 'budget.set', { category_id: await idOf('Clothing'), month: null, planned_amount_cents: 8000 }),
      change('Sort Sample Florist as Home & DIY.', 'rule.add', { pattern: 'sample florist', category_id: await idOf('Home & DIY') }),
      change('Save €1.500,00 for a holiday by next summer.', 'goal.set', { category_id: holiday.id, name: 'Holiday', target_cents: 150000, by: d.back(-8) }),
      'SCRIPT-SAY Four cards, one for each. Nothing changes until you press Apply.',
    )
    const before = app.dump()
    const replies = await replyTo(text)
    expect(replies.filter((r: any) => r.card).map((r: any) => r.card.status)).toEqual(['open', 'open', 'open', 'open'])
    expect(replies.at(-1).card.says).toContain('Nothing changes until you press Apply')
    expect(app.dump(), 'a card changed something before Apply').toEqual(before)
    const cards = page.locator('.bk-card[data-state="open"]')
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
    await Promise.all([1, 2, 3].map(() => app.post(`/chat/cards/${ruleCard.id}/apply`, { version: ruleCard.version })))
    await expect.poll(async () => (await bubble()).find((m: any) => m.card?.id === ruleCard.id).card.status).toBe('applied')
    expect((await app.json<any[]>('/rules')).filter(r => r.pattern === 'sample florist')).toHaveLength(1)
    await Promise.all([1, 2].map(() => app.post(`/chat/cards/${goalCard.id}/apply`, { version: goalCard.version })))
    await expect.poll(async () => (await bubble()).find((m: any) => m.card?.id === goalCard.id).card.status).toBe('applied')
    const goals = (await app.json('/goals')).goals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ name: 'Holiday', target_cents: 150000, category_id: holiday.id })

    // Silence: the budget card was never answered, and the plans did not move.
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(app.dump().budgets).toEqual(before.budgets)
    expect((await bubble()).find((m: any) => m.card?.id === budgetCard.id).card.status).toBe('open')
    expect((await app.transactions()).find(t => t.id === shop.id).category_name).not.toBe('Food - Not Essential')
  })

  test('R-005: a typed yes or no still answers the one card in front of it, even with the agent\'s words after it', async () => {
    const addCard = async (description: string) => script(change(`Add ${description}.`, 'transaction.add',
      { date: d.today, amount_cents: -1234, description, category_id: await idOf('Miscellaneous') }), 'SCRIPT-SAY Here is the card. Apply adds it.')
    const replies = await replyTo(await addCard('Sample Typed Yes'))
    // The agent's words arrive on the card, as one message (just-works-for-two R-002).
    expect(replies.map((r: any) => r.kind)).toEqual(['card'])
    await expect(page.locator('.bk-card .bk-says', { hasText: 'Here is the card. Apply adds it.' })).toBeVisible()
    await expect(page.locator('.bk-card[data-state="open"]')).toHaveCount(1)
    await say(page, 'yes')
    await expect(page.locator('[data-state="applied"]')).toHaveCount(1)
    expect((await app.transactions()).filter(t => t.description === 'Sample Typed Yes')).toHaveLength(1)
    const yes = (await bubble()).filter((m: any) => m.role === 'user' && m.text === 'yes').at(-1)
    expect(yes.status).toBe('done')
    expect((await bubble()).filter((m: any) => m.reply_to === yes.id), 'the yes went to the agent').toEqual([])

    await telegramReply(await addCard('Sample Typed No'))
    const count = stub.sent.length
    stub.text(DANIEL, 'no')
    await stub.reply_after(0, m => m.text.startsWith('Not applied'))
    expect(stub.sent.length).toBe(count)
    expect((await app.transactions()).some(t => t.description === 'Sample Typed No')).toBe(false)
  })

  test('R-005 R-008: earlier cards stay open; a correction replaces only the card it names', async () => {
    const add = async (description: string, extra: object = {}) => script(change(`Add ${description}.`, 'transaction.add',
      { date: d.today, amount_cents: -321, description, category_id: await idOf('Miscellaneous') }, extra))
    const [first] = await replyTo(await add('Sample Keep One'))
    const [second] = await replyTo(await add('Sample Keep Two'))
    expect((await bubble()).find((m: any) => m.id === first.id).card.status).toBe('open')
    await replyTo(`No, call it corrected\n${await add('Sample Keep Two Corrected', { replaces: [second.card.id] })}`)
    const cards = Object.fromEntries((await bubble()).filter((m: any) => m.card).map((m: any) => [m.card.summary, m.card.status]))
    expect(cards).toEqual({ 'Add Sample Keep One.': 'open', 'Add Sample Keep Two.': 'superseded', 'Add Sample Keep Two Corrected.': 'open' })
    // With more than one card open, a typed yes answers only the one made since the person last spoke.
    await expect(page.locator('.bk-card[data-state="open"]', { hasText: 'Sample Keep Two Corrected' })).toBeVisible()
    await expect(page.locator('[data-state="superseded"]')).toHaveCount(1)
    await expect(page.locator('.bk-card[data-state="open"]')).toHaveCount(2)
    await say(page, 'yes')
    await expect(page.locator('[data-state="applied"]')).toHaveCount(1)
    const rows = (await app.transactions()).map(t => t.description)
    expect(rows).toContain('Sample Keep Two Corrected')
    expect(rows).not.toContain('Sample Keep One')
  })

  test('R-006: one card holds 85 guesses, summed up in both chats with every row on request, as one Telegram message, and Apply confirms all 85', async () => {
    const guesses = await addGuesses(85, 'Sample Batch Shop Number')
    const step = script(change('Accept these 85 guesses as they stand.', 'review.confirm', { ids: guesses.map(g => g.id) }), 'SCRIPT-SAY One card for all 85.')
    await replyTo(step)
    const card = page.locator('.bk-card[data-state="open"]').last()
    // Summed up per category, with the rows themselves behind Show all (just-works-for-two R-003).
    await expect(card.locator('.bk-lines').first()).toContainText('85 payments:')
    await expect(card.locator('.bk-lines').first()).toContainText('Confirm as Miscellaneous: 85 payments')
    await expect(card.locator('.hf-batch > li').first()).toBeHidden()
    await card.locator('.hf-all > summary').click()
    await expect(card.locator('.hf-batch > li').filter({ hasText: 'Sample Batch Shop Number' })).toHaveCount(85)
    await expect(card.locator('.hf-batch > li').first()).toContainText('Reviewed: No → Yes')
    await shot(page, 'agent-batch-85-desktop')

    const count = stub.sent.length
    const [cardReply] = await telegramReply(`${step}\nSCRIPT-SAY (in Telegram)`)
    const parts = stub.sent.slice(count).filter(m => cardReply.delivered.includes(m.message_id))
    expect(parts, 'the whole card is one Telegram message').toHaveLength(1)
    expect(parts[0].text.length).toBeLessThanOrEqual(4096)
    expect(parts[0].text).toContain('Confirm as Miscellaneous: 85 payments')
    expect(parts[0].text.split('\n').length).toBeLessThan(12)
    // Asking to see everything lists the rows.
    const beforeAll = stub.sent.length
    stub.tap(DANIEL, parts[0], stub.button(parts[0], 'Show all'))
    const listed = () => stub.sent.slice(beforeAll).map(m => m.text).join('\n').split('\n').filter(line => / {2}Sample Batch Shop/.test(line))
    await expect.poll(() => listed().length, { timeout: 20_000 }).toBe(85)
    // Date, amount and as much of the name as fits a phone, in columns.
    expect(listed().every(line => /^\d+ \w{3} +\d+,\d\d {2}Sample Batch Shop/.test(line) && line.length <= 34)).toBe(true)
    expect(stub.unreadable, 'Telegram could read every layout').toEqual([])

    stub.tap(DANIEL, parts.at(-1)!, stub.button(parts.at(-1)!, 'Apply'))
    await expect.poll(() => parts[0].text, { timeout: 20_000 }).toMatch(/^Applied/)
    const after = (await app.transactions()).filter(t => t.description.startsWith('Sample Batch Shop Number '))
    expect(after.filter(t => t.confirmed)).toHaveLength(85)
    // The panel's own card for the same rows cannot apply anything a second time.
    await page.locator('.bk-card[data-state="open"]').last().getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.bk-card[data-state="failed"], .bk-card[data-state="open"]').last()).toBeVisible()
    expect((await app.transactions()).filter(t => t.description.startsWith('Sample Batch Shop Number ') && t.confirmed)).toHaveLength(85)
  })

  test('R-007: when the app turns part of a card down, the agent is told why and the person only sees the corrected card', async () => {
    const guesses = await addGuesses(3, 'Sample Fix Shop')
    const manual = (await app.transactions()).find(t => t.source === 'manual')
      ?? await app.addManual(d.inMonth(2), -999, 'Sample Manual McD', 'Food - Not Essential')
    // No SCRIPT-SAY: the reply (riding on the card) is what each tool call told the agent.
    const text = script(
      change('Accept these four guesses.', 'review.confirm', { ids: [...guesses.map(g => g.id), manual.id] }),
      change('Accept these three guesses.', 'review.confirm', { ids: guesses.map(g => g.id) }),
    )
    const replies = await replyTo(text)
    expect(replies.map((r: any) => r.kind)).toEqual(['card'])
    const told = replies[0].card.says.split('\n')
    expect(told[0]).toContain('- make_change (error): No card was shown, because the app would not take this:')
    expect(told[0]).toContain(`Row ${manual.id}`)
    expect(told[0]).toContain('is not a guess waiting for review')
    expect(told[1]).toMatch(/^- make_change: The card is shown/)
    const card = replies[0].card
    expect(card.data.changes.filter((c: any) => c.payment)).toHaveLength(3)
    expect(card.data.changes.map((c: any) => c.title).join()).not.toContain(manual.description)
    const steps = (await bubble()).find((m: any) => m.text === text).steps
    expect(steps).toContain('The app would not take that as it was, so I am correcting it')

    // A change that truly cannot be made ends in the agent's own plain explanation, not an app error.
    const bank = (await app.transactions()).find(t => t.source === 'ing')!
    const refused = script(change('Delete the bank row.', 'transaction.delete', { id: bank.id }),
      'SCRIPT-SAY I can\'t delete that one: it came from the bank file, and only manual entries can be deleted.')
    const plain = await replyTo(refused)
    expect((await bubble()).find((m: any) => m.text === refused).steps).toContain('The app would not take that as it was, so I am correcting it')
    expect(plain.map((r: any) => r.kind)).toEqual(['answer'])
    expect((await app.transactions()).some(t => t.id === bank.id)).toBe(true)
  })

  test('R-009: each step shows live in both chats within seconds, in plain words, as one Telegram message that keeps updating', async () => {
    const steps = (said: string) => script(
      'SCRIPT-SLOW 3',
      overview('Checking how this month stands'),
      query('SELECT * FROM transactions WHERE amount_cents < 0', 'SELECT 1 AS one_count'),
      query('Comparing groceries with last month', 'SELECT 2 AS two_count'),
      `SCRIPT-SAY Done looking.`,
      said,
    )
    const started = Date.now()
    await say(page, steps(''))
    const log = page.getByTestId('bk-steps')
    await expect(log.locator('li')).toHaveCount(1, { timeout: 8_000 })
    const first = Date.now() - started
    await expect(log).toContainText('Checking how this month stands')
    await shot(page, 'agent-live-log-desktop')
    await expect(log.locator('li')).toHaveCount(2, { timeout: 6_000 })
    await expect(log.locator('li').nth(1)).toHaveText('Looking through the history')
    await expect(log.locator('li')).toHaveCount(3, { timeout: 6_000 })
    expect(first).toBeLessThan(3_000 + 4_000) // its call starts after 3 seconds; it shows within a few more
    await expect(page.locator('.bk-reply', { hasText: 'Done looking.' })).toBeVisible()
    const done = page.locator('.bk-log-done').last()
    await expect(done).toContainText('Worked through · 3 steps')

    // Telegram: one log message, edited as the steps come in, never showing query text.
    const count = stub.sent.length
    stub.text(DANIEL, steps('Walk me through it in Telegram'))
    const logMessage = await stub.reply_after(count, m => m.text.startsWith('Working on it'))
    expect(stub.button(logMessage, 'Stop')).toBe('s:0')
    await expect.poll(() => logMessage.text, { timeout: 8_000 }).toContain('• Checking how this month stands')
    await expect.poll(() => logMessage.text, { timeout: 8_000 }).toContain('• Looking through the history')
    await stub.reply_after(count, m => m.text.startsWith('Done looking.'))
    // The log is taken away once the reply is there (just-works-for-two R-002).
    await expect.poll(() => logMessage.deleted === true, { timeout: 8_000 }).toBe(true)
    const fresh = stub.sent.slice(count)
    expect(fresh.filter(m => m.text.startsWith('Working on it') || m.edits.some(e => e.startsWith('Working on it')))).toHaveLength(1)
    expect(logMessage.edits.length).toBeGreaterThanOrEqual(3)
    for (const text of [...fresh.map(m => m.text), ...fresh.flatMap(m => m.edits)]) expect(text).not.toMatch(/SELECT|FROM transactions|_count/)
  })

  test('R-010: Stop in the panel ends the reply within seconds, says what was found, changes nothing and leaves earlier cards', async () => {
    const [earlier] = await replyTo(script(change('Add Sample Earlier Card.', 'transaction.add', { date: d.today, amount_cents: -500, description: 'Sample Earlier Card', category_id: await idOf('Miscellaneous') })))
    const before = app.dump()
    const dig = digging('Checking the bakery spending', BAKERY)
    await say(page, dig)
    await expect(page.getByTestId('bk-steps').locator('li').first()).toBeVisible({ timeout: 8_000 })
    await shot(page, 'agent-stop-button')
    const pressed = Date.now()
    await page.getByTestId('bk-pending').getByRole('button', { name: 'Stop' }).click()
    // The same runner, without tools, writes up what was found (botkit's script runner quotes <work_so_far>).
    const wrapUp = page.locator('.bk-reply', { hasText: 'I stopped early, so this is partial.' })
    await expect(wrapUp).toBeVisible({ timeout: 15_000 })
    expect(Date.now() - pressed).toBeLessThan(8_000)
    await expect(wrapUp).toContainText('Checking the bakery spending')
    await expect(page.locator('.bk-log-done').last()).toContainText('Stopped')
    const asked = (await bubble()).find((m: any) => m.text === dig)
    expect(asked.payload.ended).toBe('stopped')
    expect(asked.steps.at(-1)).toBe('Stopped. Writing up what I found so far')
    expect(app.dump()).toEqual(before)
    expect((await bubble()).find((m: any) => m.id === earlier.id).card.status).toBe('open')

    // Stopped before it found anything: said at once, without asking the model again.
    await say(page, script('SCRIPT-SLOW 60', query('Never gets here', 'SELECT 1 AS n_count')))
    await expect(page.getByTestId('bk-pending').getByRole('button', { name: 'Stop' })).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    await page.getByTestId('bk-pending').getByRole('button', { name: 'Stop' }).click()
    await expect(thread(page).locator('> li').last()).toHaveText('Stopped. I had not found anything yet, so I have nothing to add, and nothing changed.', { timeout: 8_000 })
  })

  test('R-001 R-010: New chat while a reply is being worked on ends it without a write-up, and the next message is answered', async () => {
    const dig = digging('Checking the bakery spending', BAKERY)
    await say(page, dig)
    await expect(page.getByTestId('bk-steps').locator('li').first()).toBeVisible({ timeout: 8_000 })
    const dug = (await bubble()).find((m: any) => m.text === dig)
    await page.getByRole('button', { name: 'New chat' }).click()
    await page.getByRole('button', { name: 'Start new chat' }).click()
    const first = noted('First question of the new chat').replace('Noted.', 'A fresh answer.')
    const replies = await replyTo(first)
    expect(replies.map((r: any) => r.text)).toEqual(['A fresh answer.'])
    expect(app.botValue(`SELECT COUNT(*) FROM bot_messages WHERE reply_to = ${dug.id}`), 'no write-up for a reply nobody will see').toEqual([[0]])
    expect((await bubble()).map((m: any) => m.text)).toEqual([first, 'A fresh answer.'])
  })

  for (const how of ['the Stop button', 'typing stop', 'typing /stop'] as const) {
    test(`R-010: in Telegram, ${how} ends the reply and says what was found`, async () => {
      const count = stub.sent.length
      stub.text(DANIEL, `Dig forever, then ${how}\n${digging('Checking the gym payments', "SELECT COUNT(*) AS gym_count FROM spending WHERE merchant LIKE 'sample gym%'")}`)
      const log = await stub.reply_after(count, m => m.text.startsWith('Working on it'))
      await expect.poll(() => log.text, { timeout: 8_000 }).toContain('Checking the gym payments')
      const pressed = Date.now()
      if (how === 'the Stop button') stub.tap(DANIEL, log, stub.button(log, 'Stop'))
      else stub.text(DANIEL, how === 'typing stop' ? 'Stop' : '/stop')
      const wrapUp = await stub.reply_after(count, m => m.text.startsWith('I stopped early, so this is partial.'))
      expect(Date.now() - pressed).toBeLessThan(8_000)
      expect(wrapUp.text).toContain('Checking the gym payments')
      // The log says it is stopping at once, and is taken away when the write-up is there (just-works-for-two R-002).
      await expect.poll(() => log.deleted === true, { timeout: 8_000 }).toBe(true)
      expect([...log.edits, log.text].some(t => t.startsWith('Stopping…'))).toBe(true)
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

    stub.text(DANIEL, `A slow Telegram question\n${script('SCRIPT-SLOW 3', query('Checking something slowly', 'SELECT 1 AS one_count'), 'SCRIPT-SAY Telegram finished its own reply.')}`)
    await stub.reply_after(count, m => m.text.startsWith('Working on it'))
    expect((await app.post('/chat/stop', { channel: 'bubble' })).stopped).toBe(0)
    await stub.reply_after(count, m => m.text === 'Telegram finished its own reply.')
  })

  // The CLI sandbox (no built-in tools, files, shell, internet, outside servers or key) is botkit's and is checked in
  // the kit. What finance can see: the agent is handed only the app's tools, and the sorter runs the CLI locked down.
  test('R-012: the agent gets only the app\'s tools: no built-in tools, files, shell or internet, no outside servers, no key', async () => {
    const replies = await replyTo(script(
      ['Bash', { command: 'cat ~/.claude/.credentials.json' }],
      ['read_file', { path: '/etc/passwd' }],
      ['web_fetch', { url: 'https://example.com' }],
      ['run_query', { doing: 'Checking the tools', queries: ['SELECT 1 AS one_count'] }],
    ))
    const lines = replies[0].text.split('\n')
    expect(lines.slice(0, 3)).toEqual([
      '- Bash (error): There is no tool called Bash.',
      '- read_file (error): There is no tool called read_file.',
      '- web_fetch (error): There is no tool called web_fetch.',
    ])
    expect(lines[3]).toMatch(/^- run_query: /)
    const runners = await app.json('/chat/runners?channel=bubble')
    expect(runners.runners.map((r: any) => r.id).sort()).toEqual(['claude-api', 'claude-cli', 'codex-cli', 'openai-api', 'script'])

    // The sorter: the same sandboxed CLI with no tools, no slash commands, no settings and no outside servers.
    await app.importCsv(ingCsv([ingRow(d.inMonth(5), 'Sample Unknown Sorter Shop', -777)]))
    const argv = app.sorterCalls().at(-1)!.argv
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(argv).toContain('--disable-slash-commands')
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('')
    expect(argv).not.toContain('--mcp-config')
  })

  test('R-013: a chart drawn by the app from the agent\'s lookup reaches both chats, with the numbers of that lookup', async () => {
    const sql = `SELECT month, category, spent_cents FROM category_months WHERE month >= '${d.back(6)}' AND month < '${d.label}' AND category IN ('Food - Essential', 'Food - Not Essential', 'Recreation & Entertainment')`
    const steps = script(
      query('Looking at spending per category over six months', sql),
      ['show_chart', { query: 'q1', type: 'bars', x: 'month', y: 'spent_cents', series: 'category', title: 'Spending per category' }],
      'SCRIPT-SAY Groceries were the biggest each month.',
    )
    const replies = await replyTo(steps)
    const chart = replies.at(-1).payload.chart
    // What that lookup returns, worked out from the synthetic history (seedHistory) the views are built from.
    const months = [6, 5, 4, 3, 2, 1].map(back => d.back(back))
    const spent: Record<string, (back: number) => number> = {
      'Food - Essential': back => 10000 + (8 - back) * 500 + 2000,
      'Food - Not Essential': () => 450 + 550,
      'Recreation & Entertainment': back => (back >= 3 ? 1299 : 1599),
    }
    expect(chart.labels).toEqual(months)
    expect(chart.series.map((s: any) => s.name).sort()).toEqual(Object.keys(spent).sort())
    for (const series of chart.series) {
      for (const [i, label] of chart.labels.entries()) {
        expect(Math.abs(series.values[i]), `${series.name} ${label}`).toBe(spent[series.name](6 - i))
      }
    }
    const picture = page.locator('img.bk-image:visible')
    await expect(picture).toHaveCount(1)
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(500)
    await shot(page, 'agent-chart-desktop')

    const photos = stub.photos.length
    await telegramReply(`${steps}\nSCRIPT-SAY (in Telegram)`)
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    expect(stub.photos.at(-1)!.body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
  })

  test('R-014: a file sent to the agent still imports and summarises as before, without Claude answering it', async () => {
    await page.getByTestId('bk-attach-input').setInputFiles({ name: 'ing.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow(d.inMonth(3), 'Sample Agent Import', -4200)])) })
    const card = page.locator('.hf-import').last()
    await expect(card).toContainText('New1')
    await app.settled('bubble')
    const file = (await bubble()).filter((m: any) => m.kind === 'file').at(-1)
    const answered = (await bubble()).filter((m: any) => m.reply_to === file.id).map((m: any) => m.kind)
    expect(answered, 'only the import summary, no reply from the agent').toEqual(['import'])
  })

  test('what the payer typed with a payment reaches the sorter and the agent, and a row without its note gets it on a second import', async () => {
    const note = 'Name: Sample Note Payer Description: Geld terug voor vliegtickets IBAN: NL00INGB0000000001 Value date: 05/09/2026'
    const csv = ingCsv([ingRow(d.inMonth(4), 'Sample Note Payer', 30000, note)])
    const calls = app.sorterCalls().length
    expect((await app.importCsv(csv)).imported).toBe(1)
    const sorter = app.sorterCalls().slice(calls).at(-1)!
    expect(sorter.prompt).toContain('"Sample Note Payer" (€300.00) note: "Geld terug voor vliegtickets"')
    expect(sorter.prompt, 'the bank fields around it stay out').not.toContain('NL00INGB0000000001')

    // What the agent's query sees, drawn as a chart's labels (the only part of a tool result that comes back whole).
    const noteSeen = async (ask: string) => {
      const replies = await replyTo(script(
        query('Reading the note', "SELECT note, 1 AS one_count FROM transactions WHERE description = 'Sample Note Payer' UNION ALL SELECT 'marker', 2"),
        ['show_chart', { query: 'q1', type: 'bars', x: 'note', y: 'one_count' }],
        `SCRIPT-SAY ${ask}`,
      ))
      return replies.at(-1).payload.chart.labels
    }
    expect(await noteSeen('It was money back for the flight tickets.')).toEqual(['Geld terug voor vliegtickets', 'marker'])

    // A row from before notes were kept: the same file sent again gives it its note and adds nothing.
    app.sql("UPDATE transactions SET note = NULL WHERE description = 'Sample Note Payer'")
    const sent = stub.sent.length
    stub.document(DANIEL, 'again.csv', csv)
    const summary = await stub.reply_after(sent, m => m.text.startsWith('ING import'))
    expect(summary.text).toBe("ING import: nothing new. All 1 payments were here already.\n1 payment already here got the bank's note.")
    expect(await noteSeen('Still the flight tickets.')).toEqual(['Geld terug voor vliegtickets', 'marker'])
  })

  test('Claude\'s bold leads and lists show as such in both chats, with a long list folded in Telegram', async () => {
    const items = ['Miscellaneous: 26', 'Food & drink: 16', 'Transfers: 15', 'Personal: 11', 'Groceries: 7', 'Transport: 7', 'Income <other>: 6']
    const words = `**96 payments are waiting**, mostly old ones.\n- Names are people\n- PRT is Portugal\n\nBy category:\n${items.map(i => `- ${i}`).join('\n')}\n**Where shall we start?**`
    await replyTo(`Can we go through the payments slowly?\n${SAY(words)}`)
    const reply = page.locator('.bk-reply').last()
    await expect(reply.locator('strong')).toHaveText(['96 payments are waiting', 'Where shall we start?'])
    await expect(reply.locator('.bk-rich-list li').first()).toHaveText('Names are people')
    await expect(reply.locator('.bk-rich-list li').last()).toHaveText('Income <other>: 6')
    expect(await reply.innerText()).not.toContain('**')

    const count = stub.sent.length
    await telegramReply(`Can we go through the payments slowly, here?\n${SAY(words)}`)
    const sent = await stub.reply_after(count, m => m.text.startsWith('96 payments are waiting'))
    expect(sent.html.split('\n').slice(0, 3)).toEqual(['<b>96 payments are waiting</b>, mostly old ones.', '• Names are people', '• PRT is Portugal'])
    expect(sent.html).toContain(`By category:\n<blockquote expandable>Miscellaneous: 26\nFood &amp; drink: 16`)
    expect(sent.html).toContain('Income &lt;other&gt;: 6</blockquote>\n<b>Where shall we start?</b>')
    expect(sent.text).not.toContain('**')
    expect(stub.unreadable).toEqual([])
  })

  test('an applied card in the panel offers to remember the shop it sorted, and remembers it only when pressed', async () => {
    const guesses = await addGuesses(2, 'Sample Offer Shop')
    await replyTo(script(change('Accept these two.', 'review.confirm', { ids: guesses.map(g => g.id) })))
    await page.locator('.bk-card[data-state="open"]').last().getByRole('button', { name: 'Apply' }).click()
    const done = page.locator('[data-state="applied"]').last()
    const offer = done.getByRole('button', { name: 'Remember Sample Offer Shop for next time' })
    await expect(offer).toBeVisible()
    await shot(page, 'agent-remember-offer-desktop')
    const rule = async () => (await app.json<any[]>('/rules')).filter(r => r.pattern === 'sample offer shop').map(r => r.category_name)
    expect(await rule(), 'nothing is remembered by itself').toEqual([])
    await offer.click()
    await expect(done).toContainText('Remembered: “sample offer shop” → Miscellaneous.')
    await expect(offer).toHaveCount(0)
    expect(await rule()).toEqual(['Miscellaneous'])
  })
})

test.describe.serial('the finance agent at its time limit', () => {
  const limited = new App({ port: port(2), fakeClaude: true, env: { CHAT_TIME_LIMIT_SECONDS: '12' } })
  const limitedStub = new TelegramStub(port(3))
  let stopLimitedBot: () => void

  test.beforeAll(async () => {
    await limited.start()
    await limited.useRunner('script', 'script', 'bubble')
    await limited.useRunner('script', 'script', 'telegram')
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
    const started = Date.now()
    await limited.post('/chat/messages', { channel: 'bubble', text: digging('Checking every month', 'SELECT 1 AS one_count', 60) })
    await new Promise(resolve => setTimeout(resolve, 2000))
    const count = limitedStub.sent.length
    limitedStub.text(DANIEL, 'Waiting behind the long one\nSCRIPT-SAY Now it is my turn.')
    await limitedStub.reply_after(count, m => m.text.startsWith('Waiting for Claude'))
    await limited.settled('bubble')
    const took = (Date.now() - started) / 1000
    expect(took).toBeGreaterThan(11)
    expect(took).toBeLessThan(30)
    const messages = (await limited.conversation('bubble')).messages
    expect(messages.at(-1).text).toMatch(/^I stopped early, so this is partial\. So far: .*Checking every month/)
    expect(messages[0].payload.ended).toBe('time')
    expect(messages[0].steps.at(-1)).toBe('Stopped. Writing up what I found so far')
    // The waiting Telegram message is answered once the long reply is over.
    await limited.settled('telegram')
    await limitedStub.reply_after(count, m => m.text === 'Now it is my turn.')
  })
})

// Ten real minutes: run with E2E_FULL_LIMIT=1 to check the limit as configured for use, not a shortened one.
test.describe.serial('the finance agent at its real time limit', () => {
  test.skip(!process.env.E2E_FULL_LIMIT, 'takes ten minutes; set E2E_FULL_LIMIT=1')
  const full = new App({ port: port(4), fakeClaude: true })

  test.beforeAll(async () => {
    await full.start()
    await full.useRunner('script', 'script', 'bubble')
  })
  test.afterAll(async () => { await full.stop(); full.destroy() })

  test('R-011: one reply ends at about ten minutes, saying it stopped early', async () => {
    test.setTimeout(900_000)
    const started = Date.now()
    await full.post('/chat/messages', { channel: 'bubble', text: digging('Checking every month', 'SELECT 1 AS one_count', 400, 2) })
    await expect.poll(async () => (await full.conversation('bubble')).messages.at(-1).role,
      { timeout: 800_000, intervals: [2000] }).toBe('assistant')
    const minutes = (Date.now() - started) / 60_000
    test.info().annotations.push({ type: 'took', description: `${minutes.toFixed(2)} minutes` })
    expect(minutes).toBeGreaterThan(8.9)
    expect(minutes).toBeLessThan(10.5)
    expect((await full.conversation('bubble')).messages.at(-1).text).toContain('I stopped early')
  })
})
