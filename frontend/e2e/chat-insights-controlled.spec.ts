/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, ING_HEADER, TelegramStub, ingRow, monthDates, openChat, say, seedHistory, shot, startBot,
} from './fixtures'

// The tools, limits, refusals and failure paths of looking further back: a scripted Claude in the real
// sandbox makes real tool calls, through the real app, Telegram bot and browser.
const app = new App({ port: 28741, fakeClaude: true })
const stub = new TelegramStub(28742)
const d = monthDates()
let stopBot: () => void
let page: Page

// Since the finance agent (2026-11-10) replies are free text: the retired "Based on" line, typed-figure
// refusals, five-round and three-minute limits are gone; their successors are in agent-controlled.spec.ts.
const query = (...queries: string[]) => ({ kind: 'query', doing: 'Looking at the history', queries })
const answer = (text: string) => ({ kind: 'answer', text })
const plain = answer
const chartStep = (chart: object) => ({ reply: { kind: 'chart', ...chart } })
const ING_LINES = (rows: string[]) => [ING_HEADER, ...rows].join('\n') + '\n'
const rowLine = (date: string, description: string, euros: string, note = '') =>
  `"${date.replaceAll('-', '')}";"${description}";"NL";"";"BA";"Debit";"${euros}";"x";"${note}";"";""`

const proposals = async (channel: 'bubble' | 'telegram') =>
  (await app.json(`/chat/messages?channel=${channel}`)).messages.filter((m: any) => m.card)
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
const clear = () => app.newChats()
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

  test('R-002: "how are we doing" needs no lookup, and the snapshot of this month does not grow with history', async () => {
    await app.addRule('sample older', 'Miscellaneous')
    app.script([{ reply: answer('Left: plenty.') }])
    await replyTo('How are we doing this month?')
    await expect(page.locator('.chat-reply').last()).toContainText('Left: plenty.')
    expect(app.calls()).toHaveLength(1)
    expect(app.toolCalls()).toEqual([])
    const contextOf = (prompt: string) => JSON.parse(/<context>\n([\s\S]*?)\n<\/context>/.exec(prompt)![1])
    const before = contextOf(app.calls()[0].prompt)
    expect(before.this_month.month).toBe(d.label)
    expect(before.this_month.left_to_spend_cents).toBe((await app.json('/dashboard/pace')).spendable_plan_cents - (await app.json('/dashboard/pace')).spendable_actual_cents)

    await app.importCsv(ING_LINES(Array.from({ length: 20 }, (_, i) => rowLine(d.backDay(12 + i, 2), `Sample Older ${i}`, '12,00'))))
    await clear()
    app.script([{ reply: answer('Left: plenty.') }])
    await replyTo('How are we doing this month?')
    expect(contextOf(app.calls()[0].prompt).this_month).toEqual(before.this_month)
    expect(app.calls()[0].prompt.length).toBeLessThan(20_000)
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
      'mcp__finance__month_overview', 'mcp__finance__propose_change', 'mcp__finance__run_query',
      'mcp__finance__show_chart', 'mcp__finance__show_choices',
    ])
    expect(app.lastCall().real_login_visible).toBe(false)
  })

  test('R-004: chat messages, proposals, settings and the real tables cannot be reached; the set-up views are app-made copies', async () => {
    const off = ['chat_messages', 'chat_proposals', 'settings', 'transaction_splits', 'sqlite_master', 'sqlite_schema', 'alembic_version']
    const rounds = []
    for (let i = 0; i < off.length; i += 3) rounds.push({ reply: query(...off.slice(i, i + 3).map(t => `SELECT * FROM ${t}`)) })
    app.script([...rounds, { reply: query('SELECT * FROM rules', 'SELECT * FROM categories') }, { reply: plain('Those are not mine to read.') }])
    await replyTo('Read the chat log')
    const results = app.queryResults()
    expect(results).toHaveLength(off.length + 2)
    for (const result of results.slice(0, off.length)) expect(result.error, result.id).toMatch(/no such table|prohibited|not authorized/i)
    const [rules, categories] = results.slice(off.length)
    expect(rules.rows.map((r: any) => r[1]).sort()).toEqual((await app.json<any[]>('/rules')).map(r => r.pattern).sort())
    expect(categories.rows.map((r: any) => r[1])).toEqual((await app.json<any[]>('/categories')).map(c => c.name))
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

  test('R-005: a query for the whole ledger is capped and marked cut off, so the agent is told', async () => {
    await app.importCsv(ING_LINES(Array.from({ length: 260 }, (_, i) => rowLine(d.backDay(8, 10), `Sample Gym extra ${i}`, '1,00', String(i)))))
    app.script([{ reply: query('SELECT * FROM transactions') }, { reply: answer('That list was cut off, so this is not all of it.') }])
    await replyTo('Give me the whole ledger')
    const [result] = app.queryResults()
    expect(result.rows).toHaveLength(200)
    expect(result.cut_off).toBe(true)
    expect(result.note).toContain('Cut off')
  })

  test('R-005: runaway queries end at their time limit, single long steps end at once, odd numbers do no harm', async () => {
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

  test('R-009 (agent R-004): months with no data and months before the first import are in what the agent is told', async () => {
    app.script([{ reply: query(`SELECT month FROM coverage WHERE month = '${d.back(7)}'`) }, { reply: answer('Looked.') }])
    await replyTo('Groceries over the last 40 months?')
    const coverage = app.coverage()
    expect(coverage.months_with_gaps.some((m: any) => m.month === d.back(7) && m.status === 'no data')).toBe(true)
    expect(coverage.first_month).toBe(d.back(31)) // the oldest row, imported by the first test
  })

  test('R-009 (agent R-004): the agent is told when one bank stops early or leaves a hole, even while another carries on', async () => {
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
        { reply: answer('Steady.') },
      ])
      await other.post('/chat/messages', { channel: 'bubble', text: 'How did it go?' })
      await expect.poll(async () => (await other.json('/chat/messages?channel=bubble')).messages.at(-1).role, { timeout: 30_000 }).toBe('assistant')
      const gaps = other.coverage().months_with_gaps
      const detail = (month: string) => gaps.find((m: any) => m.month === month)?.detail ?? ''
      expect(detail(d.back(2))).toContain(`ING rows only run from ${d.backDay(2, 0)} to ${d.backDay(2, 6)}`)
      expect(detail(d.back(3))).toContain(`ING has no rows between ${d.backDay(3, 3)} and ${d.backDay(3, 24)}`)
      expect(detail(d.back(1))).not.toContain('ING')
    } finally {
      await other.stop()
      other.destroy()
    }
  })

  const CHART_SQL = () => `SELECT month, category, spent_cents FROM category_months WHERE category IN ('Food - Essential','Miscellaneous') AND month BETWEEN '${d.back(5)}' AND '${d.back(1)}' ORDER BY month, category`
  const SPEC = { type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', series: 'category', title: 'Spending per category' }
  const chartRun = (spec: object = SPEC) => [{ reply: query(CHART_SQL()) }, chartStep(spec), { reply: answer('Food and Miscellaneous over five months.') }]

  test('R-011: a chart reaches both chats next to the text, from the numbers the query returned', async () => {
    app.script(chartRun())
    const reply = await replyTo('show spend per category over 5 months')
    const chart = reply.payload.chart
    const [result] = app.queryResults()
    expect(chart.labels).toEqual([d.back(5), d.back(4), d.back(3), d.back(2), d.back(1)])
    for (const series of chart.series) {
      expect(series.values).toEqual(chart.labels.map((m: string) => result.rows.find((r: any) => r[0] === m && r[1] === series.name)[2]))
      for (const [i, month] of chart.labels.entries()) expect(series.values[i]).toBe(await budgetCents(month, series.name))
    }
    const image = page.locator('.chat-chart:visible').last()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(400)
    await image.scrollIntoViewIfNeeded()
    await shot(page, 'insight-chart-desktop')
    const png = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${reply.id}/chart`)).arrayBuffer())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const night = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${reply.id}/chart?theme=night`)).arrayBuffer())
    expect(night.equals(png)).toBe(false)

    app.script(chartRun())
    const count = stub.sent.length
    const photos = stub.photos.length
    stub.text(DANIEL, 'show spend per category over 5 months')
    await stub.reply_after(count, m => m.text === 'Food and Miscellaneous over five months.')
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    expect(stub.photos.at(-1)!.chat_id).toBe(String(DANIEL))
    const telegramReply = (await app.json('/chat/messages?channel=telegram')).messages.at(-1)
    const telegramPng = Buffer.from(await (await fetch(`${app.base}/api/chat/messages/${telegramReply.id}/chart`)).arrayBuffer())
    expect(stub.photos.at(-1)!.body.includes(telegramPng)).toBe(true)
    await expect.poll(async () => (await app.json('/chat/outbox?channel=telegram')).replies.length).toBe(0)
  })

  test('R-011: a legend with many long names fits inside the picture', async () => {
    const wide = `SELECT month, category || ' with a long extra name' AS name, spent_cents FROM category_months WHERE month BETWEEN '${d.back(5)}' AND '${d.back(1)}' ORDER BY month, name`
    app.script([{ reply: query(wide) }, chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', series: 'name', title: 'Spending per category' }), { reply: answer('All categories.') }])
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

  test('R-011: a single number gets no chart, and a chart that cannot be made leaves the words to say so', async () => {
    const lookup = `SELECT month, spent_cents FROM category_months WHERE month = '${d.back(1)}' AND category = 'Food - Essential'`
    app.script([{ reply: query(lookup) }, chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents' }), { reply: answer('Groceries came to one number.') }])
    const photos = stub.photos.length
    const reply = await replyTo('Groceries last month, one number?')
    expect(app.toolCalls()[1]).toMatchObject({ tool: 'show_chart', isError: true })
    expect(reply.payload).toBeNull()
    await expect(page.locator('.chat-chart')).toHaveCount(0)
    expect(stub.photos.length).toBe(photos)

    for (const bad of [
      { type: 'bars', query: 'q9', x: 'month', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'nonsense', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'month', y: 'category', series: 'category' },
    ]) {
      await clear()
      app.script([{ reply: query(CHART_SQL()) }, chartStep(bad), { reply: answer('The chart could not be made this time, but Food came first.') }])
      const words = await replyTo('show spend per category over 5 months')
      expect(app.toolCalls()[1].isError, JSON.stringify(bad)).toBe(true)
      expect(app.toolCalls()[1].text).toMatch(/cannot be drawn|could not be drawn/)
      expect(words.text).toContain('Food came first')
      expect(words.payload).toBeNull()
    }

    await clear()
    app.script([{ reply: query('SELECT * FROM transactions') }, chartStep({ type: 'line', query: 'q1', x: 'date', y: 'amount_cents' }), { reply: answer('No chart.') }])
    const cut = await replyTo('chart the whole ledger')
    expect(app.toolCalls()[1].text).toContain('cut off')
    expect(cut.payload).toBeNull()
  })

  test('R-011: when Telegram refuses the picture the words stay and are not sent twice', async () => {
    app.script(chartRun())
    const count = stub.sent.length
    stub.failPhotos = true
    try {
      stub.text(DANIEL, 'show spend per category over 5 months')
      expect(await stub.reply_after(count, m => m.text.includes('chart could not be sent'))).toBeTruthy()
    } finally {
      stub.failPhotos = false
    }
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect(stub.sent.slice(count).filter(m => m.text === 'Food and Miscellaneous over five months.')).toHaveLength(1)
  })

  test('R-011: after New chat the new chart is shown, never the old picture', async () => {
    const chartFor = (category: string, title: string) => [
      { reply: query(`SELECT month, spent_cents FROM category_months WHERE category = '${category}' AND month BETWEEN '${d.back(3)}' AND '${d.back(1)}' ORDER BY month DESC`) },
      chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', title }),
      { reply: answer('Latest month first.') },
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
})
