/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, ING_HEADER, TelegramStub, euro, ingRow, monthDates, monthName, openChat, say, seedHistory, shot, startBot,
} from './fixtures'

// The tools, limits, refusals and failure paths of looking further back: a scripted Claude in the real
// sandbox makes real tool calls, through the real app, Telegram bot and browser.
const app = new App({ port: 28741, fakeClaude: true })
const stub = new TelegramStub(28742)
const d = monthDates()
let stopBot: () => void
let page: Page

const query = (...queries: string[]) => ({ kind: 'query', queries })
const answer = (text: string) => ({ kind: 'answer', text })
const plain = (text: string) => ({ kind: 'cannot', text })
const insight = (text: string, extra: object = {}) => ({
  kind: 'insight', text, scope: ['Food - Essential'], refunds: 'netted_off',
  first_month: d.back(1), last_month: d.back(1), chart: null, ...extra,
})
const silent = (text: string) => ({ kind: 'silent', text })
const BASED = () => `Based on: Food - Essential, ${monthName(d.back(1))}, refunds netted off.`
const REFUSED = 'could not back up every figure'
const LOOKUP = () => `SELECT spent_cents FROM category_months WHERE month = '${d.back(1)}' AND category = 'Food - Essential'`
const FOOD = '{q1.r1.spent_cents}'
const ING_LINES = (rows: string[]) => [ING_HEADER, ...rows].join('\n') + '\n'
const rowLine = (date: string, description: string, euros: string, note = '') =>
  `"${date.replaceAll('-', '')}";"${description}";"NL";"";"BA";"Debit";"${euros}";"x";"${note}";"";""`

const proposals = async (channel: 'bubble' | 'telegram') =>
  (await app.json(`/chat/messages?channel=${channel}`)).messages.filter((m: any) => m.card)
const settledReply = async (channel: 'bubble' | 'telegram') => {
  await app.settled(channel)
  return (await app.json(`/chat/messages?channel=${channel}`)).messages.at(-1)
}
/** Waits for the answer to this message, not for a queue that may simply not have heard of it yet. */
const replyTo = async (text: string) => {
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
  return reply
}
const clear = async () => {
  await app.json('/chat/messages?channel=bubble', { method: 'DELETE' })
  await app.json('/chat/messages?channel=telegram', { method: 'DELETE' })
}
const ledger = () => app.transactions()
const setStart = (value: string) => app.json('/settings/financial_month_start_day', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }),
})
const budgetCents = async (month: string, category: string) => (await app.budgetRow(month, category)).actual_amount_cents

test.describe.serial('looking further back, in controlled conditions', () => {
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

  test.beforeEach(clear)

  test('R-002: a question the snapshot answers runs no query, and the snapshot does not grow with history', async () => {
    await app.addRule('sample older', 'Miscellaneous')
    app.script([{ reply: answer('Left: plenty.') }])
    await replyTo('How are we doing this month?')
    await expect(page.locator('.chat-reply').last()).toContainText('Left: plenty.')
    expect(app.calls()).toHaveLength(1)
    expect(app.toolCalls().map(c => c.tool)).toEqual(['answer'])
    const dataOf = (prompt: string) => /<data>\n([\s\S]*?)\n<\/data>/.exec(prompt)![1]
    const before = dataOf(app.calls()[0].prompt)

    await app.importCsv(ING_LINES(Array.from({ length: 20 }, (_, i) => rowLine(d.backDay(12 + i, 2), `Sample Older ${i}`, '12,00'))))
    await clear()
    app.script([{ reply: answer('Left: plenty.') }])
    await replyTo('How are we doing this month?')
    expect(dataOf(app.calls()[0].prompt)).toBe(before)
  })

  test('R-002 R-001: "last 12 months" fetches the months it needs, and the oldest imported month can be reached', async () => {
    const oldest = d.back(31)
    app.script([
      { reply: query(`SELECT month, SUM(spent_cents) AS spent_cents FROM category_months WHERE month >= '${d.back(13)}' GROUP BY month ORDER BY month`) },
      { reply: query(`SELECT month, COUNT(*) AS n FROM spending WHERE month = '${oldest}' GROUP BY month`) },
      { reply: plain('Looked back.') },
    ])
    const reply = await replyTo('What did the last 12 months look like?')
    expect(reply.text).toBe('Looked back.')
    const [months, reached] = app.queryResults()
    expect(months.rows.map((r: any) => r[0])).toEqual(expect.arrayContaining([d.back(5), d.back(12)]))
    expect(reached.rows).toEqual([[oldest, 1]])
    expect(await proposals('bubble')).toHaveLength(0)
  })

  test('R-003: writes, structure changes and second statements are refused, and Claude has only the app\'s tools', async () => {
    const before = await ledger()
    const rulesBefore = await app.json('/rules')
    const statements = [
      'INSERT INTO transactions (id) VALUES (999)', 'UPDATE transactions SET amount_cents = 1', 'DELETE FROM transactions',
      'DELETE FROM category_months', 'DROP TABLE transactions', 'CREATE TABLE stolen (a)',
      'ALTER TABLE spending ADD COLUMN x', 'SELECT 1; DELETE FROM transactions', 'CREATE TEMP VIEW sneaky AS SELECT 1',
      'PRAGMA query_only = OFF', "ATTACH DATABASE 'finance.db' AS real", "REPLACE INTO coverage (month) VALUES ('x')",
      "SELECT load_extension('evil')", 'SELECT count(*) FROM sqlite_master', "SELECT count(*) FROM pragma_table_info('transactions')",
    ]
    const rounds = []
    for (let i = 0; i < statements.length; i += 3) rounds.push({ reply: query(...statements.slice(i, i + 3)) })
    app.script([...rounds, { reply: plain('I could not get at that, so nothing changed.') }])
    const reply = await replyTo('Please delete everything')
    expect(reply.text).toContain('nothing changed')
    const results = app.queryResults()
    expect(results).toHaveLength(statements.length)
    for (const result of results) {
      expect(result.error, result.id).toBeTruthy()
      expect(result.rows, result.id).toBeUndefined()
    }
    expect(await ledger()).toEqual(before)
    expect(await app.json('/rules')).toEqual(rulesBefore)

    const { argv } = app.calls()[0]
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    expect(argv).toContain('--strict-mcp-config')
    expect(argv).toContain('--disable-slash-commands')
    expect(argv[argv.indexOf('--allowedTools') + 1].split(',').sort()).toEqual([
      'mcp__finance__answer', 'mcp__finance__ask_which', 'mcp__finance__cannot_answer', 'mcp__finance__propose_change',
      'mcp__finance__run_query', 'mcp__finance__submit_insight',
    ])
    expect(app.lastCall().real_login_visible).toBe(false)
  })

  test('R-004: chat messages, proposals, settings and everything else cannot be reached', async () => {
    const off = ['chat_messages', 'chat_proposals', 'settings', 'rules', 'budgets', 'categories', 'transaction_splits', 'standing_adjustments', 'sqlite_master', 'sqlite_schema', 'alembic_version']
    const rounds = []
    for (let i = 0; i < off.length; i += 3) rounds.push({ reply: query(...off.slice(i, i + 3).map(t => `SELECT * FROM ${t}`)) })
    app.script([...rounds, { reply: plain('Those are not mine to read.') }])
    await replyTo('Read the chat log')
    const results = app.queryResults()
    expect(results).toHaveLength(off.length)
    for (const result of results) expect(result.error, result.id).toMatch(/no such table|prohibited|not authorized/i)
  })

  /** Months further back than any page opens, so a saved row there could only come from looking. */
  async function expectViewsEqualMonthPage(unopened?: string) {
    const range = `(month >= '${d.back(10)}' OR month = '${d.back(14)}')`
    app.script([
      { reply: query(`SELECT * FROM category_months WHERE spent_cents <> 0 AND ${range}`, `SELECT * FROM month_totals WHERE ${range}`, `SELECT month, category, SUM(spend_cents) AS s FROM spending WHERE ${range} AND category_type IN ('needs','wants','savings') AND counts_as IN ('spend','refund') GROUP BY month, category`) },
      { reply: plain('Compared.') },
    ])
    // Only the rows the default prompt has always added for the last four months may appear.
    const bankRows = async () => (await ledger()).filter(t => t.standing_adjustment_id === null)
    const before = await bankRows()
    await replyTo('compare')
    expect(await bankRows(), 'looking changed the ledger').toEqual(before)
    if (unopened) expect((await ledger()).filter(t => t.description === 'Sample Pocket' && t.date === `${unopened}-01`), 'an unvisited month was saved by looking').toHaveLength(0)
    const [byCategory, totals, spending] = app.queryResults()
    expect(byCategory.cut_off).toBe(false)
    expect(byCategory.rows.some((r: any) => r[0] === d.back(7)), 'a month with only a standing adjustment').toBe(true)
    for (const month of [...Array.from({ length: 11 }, (_, back) => d.back(back)), d.back(14)]) {
      for (const row of await app.json<any[]>(`/budget?month=${month}`)) {
        const mine = byCategory.rows.find((r: any) => r[0] === month && r[1] === row.category_name)
        expect(mine?.[3] ?? 0, `${month} ${row.category_name}`).toBe(row.actual_amount_cents)
        const summed = spending.rows.find((r: any) => r[0] === month && r[1] === row.category_name)?.[2] ?? 0
        expect(summed, `spending ${month} ${row.category_name}`).toBe(row.actual_amount_cents)
      }
      const summary = await app.json(`/dashboard/summary?month=${month}`)
      const total = totals.rows.find((r: any) => r[0] === month)
      expect(total?.[1] ?? 0, `income ${month}`).toBe(summary.total_income_cents)
      expect(total?.[2] ?? 0, `expenses ${month}`).toBe(summary.total_expenses_cents)
      expect(total?.[6] ?? 0, `left over ${month}`).toBe(summary.left_over_cents)
    }
  }

  test('R-004: the views equal the Month page with a split, a refund, an excluded row, a standing adjustment and a moved month start', async () => {
    const ah = (await ledger()).filter(t => t.description === 'Albert Heijn 1234' && t.date === d.backDay(2, 1))[0]
    const food = await app.category('Food - Essential')
    const clothing = await app.category('Clothing')
    await app.json(`/transactions/${ah.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ splits: [{ category_id: food.id, amount_cents: ah.amount_cents + 3000 }, { category_id: clothing.id, amount_cents: -3000 }] }),
    })
    await app.addManual(d.backDay(2, 9), 1500, 'Sample Refund Row', 'Food - Essential', true)
    await app.addManual(d.backDay(4, 9), 700, 'Sample Older Refund', 'Clothing', true)
    await app.importCsv(ING_LINES([rowLine(d.backDay(2, 11), 'Sample Transfer', '444,00')]))
    await app.post('/standing-adjustments', {
      name: 'Sample Pocket', amount_cents: 5000, start_month: `${d.back(20)}-01`,
      income_category_id: (await app.category('Retained Salary')).id,
      expense_category_id: (await app.category('Personal Allowance')).id,
    })
    expect((await ledger()).some(t => t.description === 'Sample Pocket' && t.date === `${d.back(14)}-01`)).toBe(false)
    await expectViewsEqualMonthPage(d.back(14))
    expect(await budgetCents(d.back(2), 'Clothing')).toBe(3000)

    await setStart('5')
    await clear()
    await expectViewsEqualMonthPage()
    await setStart('24')
  })

  test('R-004: a standing adjustment from before the first import is counted like the Month page, whatever ran before', async () => {
    const own = new App({ port: 28744, fakeClaude: true })
    await own.start()
    try {
      await own.addRule('sample shop', 'Miscellaneous')
      await own.importCsv(ING_LINES([rowLine(d.backDay(2, 3), 'Sample Shop', '10,00')]))
      await own.post('/standing-adjustments', {
        name: 'Sample Early Pocket', amount_cents: 5000, start_month: `${d.back(10)}-01`,
        income_category_id: (await own.category('Retained Salary')).id,
        expense_category_id: (await own.category('Personal Allowance')).id,
      })
      own.script([
        { reply: query(`SELECT month, category, spent_cents FROM category_months WHERE spent_cents <> 0`, 'SELECT * FROM month_totals') },
        { reply: plain('Compared.') },
      ])
      await own.post('/chat/messages', { channel: 'bubble', text: 'compare' })
      await expect.poll(async () => (await own.json('/chat/messages?channel=bubble')).messages.at(-1).role, { timeout: 30_000 }).toBe('assistant')
      const [byCategory, totals] = own.queryResults()
      for (let back = 10; back >= 3; back--) {
        const month = d.back(back)
        const allowance = (await own.budgetRow(month, 'Personal Allowance')).actual_amount_cents
        expect(allowance, month).toBe(5000)
        expect(byCategory.rows.find((r: any) => r[0] === month && r[1] === 'Personal Allowance')?.[2], month).toBe(allowance)
        const summary = await own.json(`/dashboard/summary?month=${month}`)
        expect(totals.rows.find((r: any) => r[0] === month)?.[2], month).toBe(summary.total_expenses_cents)
      }
    } finally {
      await own.stop()
      own.destroy()
    }
  })

  test('R-005: a query for the whole ledger is capped, marked cut off and steers Claude, and the answer says so', async () => {
    await app.importCsv(ING_LINES(Array.from({ length: 260 }, (_, i) => rowLine(d.backDay(8, 10), `Sample Gym extra ${i}`, '1,00', String(i)))))
    const every = { scope: ['all payments'], first_month: d.back(8), last_month: d.label, refunds: 'not_netted_off' }
    app.script([{ reply: query('SELECT * FROM transactions') }, { reply: insight('Here is what I saw, starting with {q1.r1.description}.', every) }])
    const reply = await replyTo('Give me the whole ledger')
    const [result] = app.queryResults()
    expect(result.rows).toHaveLength(200)
    expect(result.cut_off).toBe(true)
    expect(result.note).toContain('Cut off')
    expect(reply.text).toContain('cut off, so this is not the complete list')

    await clear()
    app.script([{ reply: query('SELECT * FROM transactions', 'SELECT 1 AS n_count') }, { reply: insight('The short lookup said {q2.r1.n_count}.', every) }])
    expect((await replyTo('Citing something else')).text).toContain('An earlier lookup was cut off')

    await clear()
    app.script([{ reply: query('SELECT * FROM transactions') }, { reply: plain('I could not work that out.') }])
    expect((await replyTo('Giving up on it')).text).toContain('cut off, so this is not the complete list')
  })

  test('R-005 R-006: runaway queries end at the time limit, single long steps end at once, odd numbers do no harm', async () => {
    const big = `printf('%.*c', 999000, 'a')`
    app.script([
      { reply: query('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT max(n) FROM r') },
      { reply: query(`SELECT glob('*' || ${big} || 'b', ${big})`, `SELECT ${big} LIKE '%' || ${big} || 'b'`, `SELECT instr(${big} || ${big}, ${big} || 'b')`) },
      { reply: query('SELECT 9e999 AS x') },
      { reply: plain('That could not be worked out.') },
    ])
    const started = Date.now()
    const reply = await replyTo('Stall on purpose')
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(reply.text).toContain('That could not be worked out.')
    const results = app.queryResults()
    expect(results[0].error).toContain('Stopped after 2 seconds')
    expect(results.at(-1).rows).toEqual([[null]])
  })

  const DRAFT = () => ({ text: `Groceries came to ${FOOD}.`, scope: ['Food - Essential'], refunds: 'netted_off', first_month: d.back(1), last_month: d.back(1) })

  test('R-006: a question that keeps querying is stopped after five rounds and gives its best answer, marked partial', async () => {
    expect(euro(await budgetCents(d.back(1), 'Food - Essential'))).toBe('€155,00')
    app.script([{ reply: { ...query(LOOKUP()), draft: DRAFT() } }])
    const reply = await replyTo('Keep digging')
    const calls = app.toolCalls().filter(c => c.tool === 'run_query')
    expect(calls.filter(c => !c.isError)).toHaveLength(5)
    expect(calls.at(-1)!.text).toContain('limit for this question has been reached')
    expect(reply.text).toContain('Groceries came to €155,00.')
    expect(reply.text).toContain('I stopped early, so this answer is partial.')
    expect(reply.text.trim().split('\n').at(-1)).toBe(BASED())
  })

  test('R-006: with no answer so far the reply still says it stopped, with no figures', async () => {
    app.script([{ reply: query('SELECT 1') }])
    const reply = await replyTo('Keep digging, no draft')
    expect(reply.text).toContain('I stopped early')
    expect(reply.text).toContain('partial')
    expect(reply.text).not.toMatch(/€\d/)
  })

  test('R-006: slow rounds end with a reply within about three minutes, marked partial', async () => {
    app.script([{ reply: { ...query(LOOKUP()), draft: DRAFT() }, delay: 40 }])
    const started = Date.now()
    const reply = await replyTo('Keep digging slowly')
    const seconds = (Date.now() - started) / 1000
    expect(seconds).toBeGreaterThan(150)
    expect(seconds).toBeLessThan(195)
    expect(reply.text).toContain('I stopped early')
  })

  test('R-006: with time running out the tool tells Claude to answer from what it has', async () => {
    app.script([
      { reply: query(LOOKUP()), delay: 45 }, { reply: query(LOOKUP()), delay: 45 }, { reply: query(LOOKUP()), delay: 45 },
      { reply: insight(`Groceries came to ${FOOD}.`) },
    ])
    const reply = await replyTo('Dig until the clock says stop')
    const calls = app.toolCalls()
    expect(calls.filter(c => c.tool === 'run_query').at(-1)!.text).toContain('limit for this question has been reached')
    expect(calls.at(-1)!.tool).toBe('submit_insight')
    expect(reply.text).toContain('€155,00')
    expect(reply.text).toContain('I stopped early')
  })

  test('R-007: digging shows in both chats, and a message behind it still gets the waiting note', async () => {
    app.script([{ reply: query('SELECT 1 AS n'), delay: 1 }, { reply: plain('Slowly done.'), delay: 8 }])
    await say(page, 'A slow one')
    await expect(page.getByTestId('chat-pending')).toContainText('Looking through the history')
    await shot(page, 'insight-digging-desktop')
    await settledReply('bubble')

    app.script([{ reply: query('SELECT 1 AS n'), delay: 1 }, { reply: plain('Telegram done.'), delay: 8 }])
    const count = stub.sent.length
    const typingBefore = stub.calls.filter(c => c === 'sendChatAction').length
    stub.text(DANIEL, 'A slow one')
    expect(await stub.reply_after(count, m => m.text.startsWith('Looking through the history'))).toBeTruthy()
    await stub.reply_after(count, m => m.text === 'Telegram done.')
    expect(stub.calls.filter(c => c === 'sendChatAction').length).toBeGreaterThan(typingBefore)

    app.script([{ reply: query('SELECT 1 AS n'), delay: 6 }, { reply: plain('First done.') }])
    await say(page, 'Holding the line')
    await expect(page.getByTestId('chat-pending')).toBeVisible()
    const waiting = stub.sent.length
    stub.text(DANIEL, 'Behind it')
    expect(await stub.reply_after(waiting, m => m.text.startsWith('Waiting for Claude'))).toBeTruthy()
    await app.settled('telegram')
    await app.settled('bubble')
  })

  test('R-008: the app writes one plain Based on line, last, from what the answer declares', async () => {
    app.script([{ reply: query(LOOKUP()) }, { reply: insight(`Groceries came to ${FOOD}.`) }])
    const reply = await replyTo('Groceries last month?')
    expect(reply.text.trim().split('\n').at(-1)).toBe(BASED())
    expect(reply.text.match(/^Based on/gm)).toHaveLength(1)
    expect(reply.text).not.toMatch(/SELECT|category_months|spent_cents/)
  })

  test('R-008: query text is sent back to be reworded, and the corrected answer goes out', async () => {
    app.script([
      { reply: query(LOOKUP()) },
      { reply: insight(`I ran SELECT spent_cents FROM category_months and got ${FOOD}.`) },
      { reply: insight(`Groceries came to ${FOOD}.`) },
    ])
    const reply = await replyTo('Show your working')
    expect(app.toolCalls()[1].isError).toBe(true)
    expect(app.toolCalls()[1].text).toContain('without query text')
    expect(reply.text).toContain('Groceries came to €155,00.')
    expect(reply.text).not.toMatch(/SELECT|category_months/)
  })

  test('R-008: query text in any case is sent back, while ordinary words like "select" are fine', async () => {
    app.script([
      { reply: query(LOOKUP()) },
      { reply: insight(`i ran select spent from spending where month is last month, and got ${FOOD}.`) },
      { reply: insight(`Select a month from the list to compare: groceries came to ${FOOD}.`) },
    ])
    const reply = await replyTo('Groceries, in lower case?')
    expect(app.toolCalls()[1].text).toContain('without query text')
    expect(reply.text).toContain('Select a month from the list to compare: groceries came to €155,00.')
  })

  test('R-008: an answer has to say what it covers, in names the data knows', async () => {
    for (const bad of [
      { reply: insight(`Groceries came to ${FOOD}.`, { scope: ['Martian Imports'] }), expected: 'not categories or merchants' },
      { reply: insight(`Groceries came to ${FOOD}.`, { scope: [] }), expected: 'scope' },
      { reply: insight(`Groceries came to ${FOOD}.`, { refunds: 'maybe' }), expected: 'refunds' },
      { reply: insight(`Groceries came to ${FOOD}.`, { first_month: 'recently' }), expected: 'first_month' },
      { reply: insight(`Groceries came to ${FOOD}.`, { scope: [''] }), expected: 'scope' },
      { reply: insight(`Groceries came to ${FOOD}.`, { chart: undefined }), expected: 'chart' },
      { reply: insight('Groceries went up.'), expected: 'Cite at least one' },
    ]) {
      await clear()
      app.script([{ reply: query(LOOKUP()) }, { reply: bad.reply }])
      const reply = await replyTo('How did groceries do?')
      expect(app.toolCalls().find(c => c.tool === 'submit_insight')!.text, JSON.stringify(bad)).toContain(bad.expected)
      expect(reply.text).not.toContain('€155,00')
    }
  })

  test('R-009: a typed or spelled-out figure never reaches the person', async () => {
    for (const text of [
      'Groceries came to €999,99.', 'Groceries came to 999 euros.', 'Groceries came to 123,45 EUR.', 'Groceries came to $999.',
      'Groceries came to about 2k.', 'Groceries went from 999 to 1234 a month.', 'Groceries came to nine hundred euros.',
      'Groceries rose by about two hundred.', 'Groceries came to two hundred EUR.', 'Groceries rose fifty percent.',
      'Groceries came to five thousand bucks.', 'Streaming went to fifteen ninety-nine.', 'Groceries ran at around fifty a month.',
    ]) {
      await clear()
      app.script([{ reply: query(LOOKUP()) }, { reply: insight(`${text} That was ${FOOD}.`) }])
      const reply = await replyTo('How much on groceries?')
      expect(reply.text, text).toContain(REFUSED)
      expect(reply.text).not.toMatch(/999|123,45|2k|1234|hundred|percent|thousand|fifteen|fifty/)
    }

    // A shop whose name holds such a word is still named, small counts read as words, and refusals say what they objected to.
    await app.addRule('euro shop', 'Home & DIY')
    await app.importCsv(ING_LINES([rowLine(d.backDay(1, 8), 'Euro Shop Utrecht', '19,95')]))
    await clear()
    app.script([
      { reply: query(`SELECT merchant, -SUM(amount_cents) AS spent_cents FROM transactions WHERE merchant = 'euro shop utrecht'`) },
      { reply: insight('Three shops stood out over six months, and Euro Shop came to {q1.r1.spent_cents}.', { scope: ['Euro Shop Utrecht'] }) },
    ])
    expect((await replyTo('How much at Euro Shop?')).text).toContain('Three shops stood out over six months, and Euro Shop came to €19,95.')

    await clear()
    app.script([
      { reply: query(LOOKUP()) },
      { reply: plain('It was probably around fifty a month.') },
      { reply: plain('I could not work that out.') },
    ])
    expect((await replyTo('Roughly?')).text).toBe('I could not work that out.')
    expect(app.toolCalls()[1].text).toContain("'fifty'")
    expect(app.toolCalls()[1].text).toContain('call cannot_answer again')

    await clear()
    app.script([{ reply: query(LOOKUP()) }, { reply: insight(`Groceries rose by {q1.r1.spent_cents}%.`) }, { reply: insight(`Like Eurowings and Eurospar, groceries came to ${FOOD}.`) }])
    const named = await replyTo('Names with euro in them')
    expect(app.toolCalls().find(c => c.tool === 'submit_insight')!.text).toContain("'%'")
    expect(named.text).toContain('Like Eurowings and Eurospar, groceries came to €155,00.')
  })

  test('R-009: references resolve only to real cells, and the column decides how a value is shown', async () => {
    for (const [ref, expected] of [['{q9.r1.spent_cents}', 'no result q9'], ['{q1.r9.spent_cents}', 'rows r1 to r1'], ['{q1.r1.nope}', 'has columns']]) {
      await clear()
      app.script([{ reply: query(LOOKUP()) }, { reply: insight(`Groceries came to ${ref}.`) }])
      const reply = await replyTo('Bad reference')
      expect(app.toolCalls().at(-1)!.text).toContain(expected)
      expect(reply.text).toContain(REFUSED)
    }
    await clear()
    app.script([
      { reply: query(`SELECT count(*) AS n_count, 1.9 AS growth_pct, 32.5 AS spent_eur, '${d.back(1)}' AS month, 'Average' AS label, 91250 AS total FROM spending WHERE month = '${d.back(1)}'`) },
      { reply: insight('In {q1.r1.month} the total was {q1.r1.total}.') },
      { reply: insight('Across {q1.r1.month} there were {q1.r1.n_count} rows, up {q1.r1.growth_pct}, worth {q1.r1.spent_eur}.') },
    ])
    const reply = await replyTo('Show each kind of figure')
    expect(app.toolCalls()[1].text).toContain('name the column for its unit')
    const count = app.queryResults()[0].rows[0][0]
    expect(reply.text).toContain(`Across ${monthName(d.back(1))} there were ${count} rows, up 1,9%, worth €32,50.`)

    await clear()
    app.script([{ reply: query(`SELECT 'Average' AS month, 15500 AS spent_cents`) }, { reply: insight('The {q1.r1.month} came to {q1.r1.spent_cents}.') }])
    expect((await replyTo('An odd label')).text).toContain('The Average came to €155,00.')
  })

  test('R-009: a failed query gives a plain sentence and no made-up number', async () => {
    app.script([{ reply: query('SELECT nope FROM nowhere') }, { reply: plain('It was probably around 250 euros.') }, { reply: plain('It was probably around two hundred and fifty euros.') }])
    const made = await replyTo('Guess for me')
    expect(made.text).not.toMatch(/250|hundred/)

    await clear()
    app.script([{ reply: query('SELECT nope FROM nowhere') }, { reply: plain('I could not work that out from the data.') }])
    const before = await ledger()
    const honest = await replyTo('Can you?')
    expect(honest.text).toBe('I could not work that out from the data.')
    expect(await ledger()).toEqual(before)
    expect(await proposals('bubble')).toHaveLength(0)
    expect(app.queryResults()[0].error).toMatch(/no such (table|column)/)

    await clear()
    app.script([{ reply: query(LOOKUP()) }, { reply: { kind: 'clarify', text: 'Did you mean the €7.777,77 from SELECT x FROM y?', transaction_ids: [] } }])
    const asked = await replyTo('Which one?')
    expect(asked.text).not.toMatch(/7\.777|SELECT/)
  })

  test('R-009: gaps in the asked period are named, including months before the first import', async () => {
    app.script([{ reply: query(LOOKUP()) }, { reply: insight(`Groceries came to ${FOOD}.`, { first_month: d.back(40) }) }])
    const reply = await replyTo('Groceries over the last 40 months?')
    expect(reply.text).toContain('Gaps in this period')
    expect(reply.text).toContain('nothing was imported before')
    expect(reply.text).toContain(`no bank data for ${monthName(d.back(7))}`)
    expect(reply.text.trim().split('\n').at(-1)).toMatch(/^Based on: Food - Essential, /)
    expect(app.coverage().months_with_gaps.some((m: any) => m.month === d.back(7) && m.status === 'no data')).toBe(true)
  })

  test('R-009: one bank stopping early, or a hole inside a month, is named even while another bank carries on', async () => {
    const other = new App({ port: 28743, fakeClaude: true })
    await other.start()
    try {
      await other.addRule('sample card', 'Miscellaneous')
      await other.addRule('sample wallet', 'Miscellaneous')
      const ingRows: string[] = []
      const revolut = ['Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance']
      for (let back = 3; back >= 1; back--) {
        for (let day = 0; day <= 28; day += 3) {
          const stopped = back === 2 && day > 6
          const hole = back === 3 && day > 3 && day < 24
          if (!stopped && !hole) ingRows.push(ingRow(d.backDay(back, day), 'Sample Card', -500, `c${back}-${day}`))
          revolut.push(`CARD_PAYMENT,Current,${d.backDay(back, day)} 10:00:00,${d.backDay(back, day)} 10:00:00,Sample Wallet,-5.00,0.00,EUR,COMPLETED,10.00`)
        }
      }
      await other.importCsv(ING_LINES(ingRows))
      await other.importCsv(revolut.join('\n') + '\n', 'revolut')
      other.script([
        { reply: query(`SELECT SUM(spent_cents) AS spent_cents FROM category_months WHERE category = 'Miscellaneous' AND month = '${d.back(1)}'`) },
        { reply: insight(`Steady at ${FOOD}.`, { scope: ['Miscellaneous'], first_month: d.back(3), last_month: d.back(1) }) },
      ])
      await other.post('/chat/messages', { channel: 'bubble', text: 'How did it go?' })
      await expect.poll(async () => (await other.json('/chat/messages?channel=bubble')).messages.at(-1).role, { timeout: 30_000 }).toBe('assistant')
      const reply = (await other.json('/chat/messages?channel=bubble')).messages.at(-1)
      expect(reply.text).toContain('Gaps in this period')
      expect(reply.text).toContain(`in ${monthName(d.back(2))}, ING rows only run from ${d.backDay(2, 0)} to ${d.backDay(2, 6)}`)
      expect(reply.text).toContain(`ING has no rows between ${d.backDay(3, 3)} and ${d.backDay(3, 24)}`)
      expect(reply.text).not.toContain(`${monthName(d.back(1))}, ING`)
    } finally {
      await other.stop()
      other.destroy()
    }
  })

  test('R-007 R-009: a turn that forgets to reply is asked again, with what it already found', async () => {
    app.script([{ reply: silent('Left: plenty, but I forgot the tool.') }, { reply: answer('Left: plenty.') }])
    expect((await replyTo('How are we doing?')).text).toBe('Left: plenty.')
    expect(app.calls()).toHaveLength(2)
    expect(app.calls()[1].prompt).toContain('I forgot the tool')

    await clear()
    app.script([{ reply: query(LOOKUP()) }, { reply: silent('Groceries were steady.') }, { reply: insight(`Groceries came to ${FOOD}.`) }])
    const reply = await replyTo('Groceries last month, forgetting once?')
    expect(app.calls()).toHaveLength(2)
    expect(app.calls()[1].prompt).toContain('<query_results>')
    expect(reply.text).toContain('Groceries came to €155,00.')
    expect(reply.text).not.toContain('stopped early')

    await clear()
    app.script([{ reply: query(LOOKUP()) }, { reply: silent('Groceries were steady.') }])
    const unfinished = await replyTo('Groceries, forgetting twice?')
    expect(unfinished.text).toContain('could not finish working that out')
    expect(unfinished.text).not.toContain('stopped early')
  })

  test('R-010: a change the person asks for still gets its card after a lookup, and changes nothing until Apply', async () => {
    const clothing = await app.category('Clothing')
    const row = (await ledger()).find(t => t.description === 'Albert Heijn 1234' && t.date === d.backDay(8, 1))
    const before = await ledger()
    app.script([
      { reply: query("SELECT transaction_id, description, date FROM spending WHERE description = 'Albert Heijn 1234' ORDER BY date LIMIT 1") },
      { reply: { kind: 'propose', summary: 'Move the oldest grocery payment to Clothing.', op: 'transaction.update', args: { id: row.id, category_id: clothing.id } } },
    ])
    const reply = await replyTo('That shop from eight months ago should be Clothing')
    expect(app.toolCalls().map(c => [c.tool, c.isError])).toEqual([['run_query', false], ['propose_change', false]])
    expect(reply.card?.status).toBe('pending')
    expect(await ledger()).toEqual(before)
    await page.locator('.chat-card[data-state="pending"]').last().getByRole('button', { name: 'Not this' }).click()
  })

  const CHART_SQL = () => `SELECT month, category, spent_cents FROM category_months WHERE category IN ('Food - Essential','Miscellaneous') AND month BETWEEN '${d.back(5)}' AND '${d.back(1)}' ORDER BY month, category`
  const SPEC = { type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', series: 'category', title: 'Spending per category' }
  const chartAnswer = (chart: unknown, text = 'Food came to {q1.r9.spent_cents} and Miscellaneous to {q1.r10.spent_cents} in {q1.r9.month}.') => insight(text, {
    scope: ['Food - Essential', 'Miscellaneous'], first_month: d.back(5), last_month: d.back(1), chart,
  })

  test('R-011: a chart reaches both chats next to the text, from the numbers the query returned', async () => {
    app.script([{ reply: query(CHART_SQL()) }, { reply: chartAnswer(SPEC) }])
    const reply = await replyTo('show spend per category over 5 months')
    const chart = reply.payload.chart
    const [result] = app.queryResults()
    expect(chart.labels).toEqual([d.back(5), d.back(4), d.back(3), d.back(2), d.back(1)])
    for (const series of chart.series) {
      expect(series.values).toEqual(chart.labels.map((m: string) => result.rows.find((r: any) => r[0] === m && r[1] === series.name)[2]))
      for (const [i, month] of chart.labels.entries()) expect(series.values[i]).toBe(await budgetCents(month, series.name))
    }
    expect(reply.text).toContain(euro(chart.series.find((s: any) => s.name === 'Food - Essential').values.at(-1)))

    const image = page.locator('.chat-chart:visible').last()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(400)
    await image.scrollIntoViewIfNeeded()
    await shot(page, 'insight-chart-desktop')
    const png = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${reply.id}/chart`)).arrayBuffer())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const night = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${reply.id}/chart?theme=night`)).arrayBuffer())
    expect(night.equals(png)).toBe(false)

    app.script([{ reply: query(CHART_SQL()) }, { reply: chartAnswer(SPEC) }])
    const count = stub.sent.length
    const photos = stub.photos.length
    stub.text(DANIEL, 'show spend per category over 5 months')
    await stub.reply_after(count, m => m.text.includes('Based on:'))
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    expect(stub.photos.at(-1)!.chat_id).toBe(String(DANIEL))
    const telegramReply = (await app.json('/chat/messages?channel=telegram')).messages.at(-1)
    const telegramPng = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${telegramReply.id}/chart`)).arrayBuffer())
    expect(stub.photos.at(-1)!.body.includes(telegramPng)).toBe(true)
    await expect.poll(async () => (await app.json('/chat/outbox?channel=telegram')).replies.length).toBe(0)
  })

  test('R-011: a legend with many long names fits inside the picture', async () => {
    const wide = `SELECT month, category || ' with a long extra name' AS name, spent_cents FROM category_months WHERE month BETWEEN '${d.back(5)}' AND '${d.back(1)}' ORDER BY month, name`
    app.script([{ reply: query(wide) }, { reply: insight('Spending started at {q1.r1.spent_cents}.', {
      scope: ['all categories'], first_month: d.back(5), last_month: d.back(1),
      chart: { type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', series: 'name', title: 'Spending per category' },
    }) }])
    const reply = await replyTo('show all categories over 5 months')
    expect(reply.payload.chart.series.length).toBeGreaterThanOrEqual(6)
    expect(reply.payload.chart.series.at(-1).name).toBe('Other')
    expect(reply.payload.chart.unit).toBe('cents')
    const image = page.locator('.chat-chart:visible').last()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(400)
    await image.scrollIntoViewIfNeeded()
    await shot(page, 'insight-chart-legend-desktop')
    // Text cut off by the picture's edge leaves ink in its outermost columns and rows.
    const edgesClear = await image.evaluate((el: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = el.naturalWidth; canvas.height = el.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(el, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
      const at = (x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]
      const surface = at(0, 0)
      const same = (p: number[]) => p.every((v, i) => Math.abs(v - surface[i]) < 12)
      for (let y = 0; y < height; y++) for (const x of [0, 1, 2, width - 3, width - 2, width - 1]) if (!same(at(x, y))) return false
      for (let x = 0; x < width; x++) for (const y of [height - 3, height - 2, height - 1]) if (!same(at(x, y))) return false
      return true
    })
    expect(edgesClear).toBe(true)
  })

  test('R-011: a single number gets no chart', async () => {
    const lookup = `SELECT month, spent_cents FROM category_months WHERE month = '${d.back(1)}' AND category = 'Food - Essential'`
    app.script([{ reply: query(lookup) }, { reply: insight(`Groceries came to ${FOOD.replace('spent_cents', 'spent_cents')}.`, { chart: { type: 'bars', query: 'q1', x: 'month', y: 'spent_cents' } }) }])
    const photos = stub.photos.length
    const reply = await replyTo('Groceries last month, one number?')
    expect(reply.payload).toBeNull()
    expect(reply.text).not.toContain('chart')
    await expect(page.locator('.chat-chart')).toHaveCount(0)
    expect(stub.photos.length).toBe(photos)
  })

  test('R-011: when a chart cannot be made the words still arrive with a short note', async () => {
    for (const bad of [
      { type: 'bars', query: 'q9', x: 'month', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'nonsense', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'month', y: 'category', series: 'category' },
    ]) {
      await clear()
      app.script([{ reply: query(CHART_SQL()) }, { reply: chartAnswer(bad) }])
      const reply = await replyTo('show spend per category over 5 months')
      expect(reply.text).toContain('Food came to')
      expect(reply.text).toContain('The chart could not be made this time.')
      expect(reply.payload).toBeNull()
    }

    await clear()
    app.script([{ reply: query('SELECT * FROM transactions') }, { reply: insight('Starting from {q1.r1.description}.', { scope: ['all payments'], chart: { type: 'line', query: 'q1', x: 'date', y: 'amount_cents' } }) }])
    const cut = await replyTo('chart the whole ledger')
    expect(cut.text).toContain('The chart could not be made this time.')
    expect(cut.payload).toBeNull()
  })

  test('R-011: when Telegram refuses the picture the words stay and are not sent twice', async () => {
    app.script([{ reply: query(CHART_SQL()) }, { reply: chartAnswer(SPEC) }])
    const count = stub.sent.length
    stub.failPhotos = true
    try {
      stub.text(DANIEL, 'show spend per category over 5 months')
      expect(await stub.reply_after(count, m => m.text.includes('chart could not be sent'))).toBeTruthy()
    } finally {
      stub.failPhotos = false
    }
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect(stub.sent.slice(count).filter(m => m.text.includes('Based on:'))).toHaveLength(1)
  })

  test('R-011: after Clear the new chart is shown, never the old picture', async () => {
    const chartFor = (category: string, title: string) => [
      { reply: query(`SELECT month, spent_cents FROM category_months WHERE category = '${category}' AND month BETWEEN '${d.back(3)}' AND '${d.back(1)}' ORDER BY month DESC`) },
      { reply: insight('Latest: {q1.r1.spent_cents}.', { scope: [category], first_month: d.back(3), last_month: d.back(1), chart: { type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', title } }) },
    ]
    app.script(chartFor('Food - Essential', 'Food'))
    const first = await replyTo('Chart the food')
    expect(first.payload.chart.labels).toEqual([d.back(3), d.back(2), d.back(1)])
    const firstSrc = await page.locator('.chat-chart:visible').last().getAttribute('src')

    await clear()
    await expect(page.locator('.chat-chart')).toHaveCount(0)
    app.script(chartFor('Miscellaneous', 'Other things'))
    const second = await replyTo('Chart the rest')
    const image = page.locator('.chat-chart:visible').last()
    await expect(image).toBeVisible()
    expect(await image.getAttribute('src')).not.toBe(firstSrc)
    const shown = await image.evaluate(async (el: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(el.currentSrc, { cache: 'force-cache' })).arrayBuffer())))
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    const current = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${second.id}/chart?theme=${theme}`)).arrayBuffer())
    expect(Buffer.from(shown).equals(current)).toBe(true)
  })

  test('R-011: a chart comes from a result the text cites, and its title is plain words', async () => {
    const months = `SELECT month, spent_cents FROM category_months WHERE category = 'Miscellaneous' AND month BETWEEN '${d.back(3)}' AND '${d.back(1)}' ORDER BY month`
    const spec = { type: 'line', query: 'q2', x: 'month', y: 'spent_cents' }
    app.script([{ reply: query(LOOKUP(), months) }, { reply: insight(`Groceries came to ${FOOD}.`, { chart: spec }) }])
    const notCited = await replyTo('Chart one thing, cite another')
    expect(notCited.text).toContain('The chart could not be made this time.')
    expect(notCited.payload).toBeNull()

    for (const title of ['Total €9.999,99', 'Food rose by 999', 'from SELECT x FROM y']) {
      await clear()
      app.script([{ reply: query(LOOKUP(), months) }, { reply: insight(`Miscellaneous came to {q2.r3.spent_cents}.`, { chart: { ...spec, title } }) }])
      const bad = await replyTo('Chart with a bad title')
      expect(bad.text, title).toContain(REFUSED)
      expect(bad.payload).toBeNull()
    }
  })
})
