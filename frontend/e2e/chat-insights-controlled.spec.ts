/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, ING_HEADER, TelegramStub, ingRow, monthDates, openChat, port, repo, say, script, seedHistory, shot, startBot, GROUP,
} from './fixtures'

// The tools, limits, refusals and failure paths of looking further back: botkit's scripted model makes real tool
// calls (SCRIPT-TOOL lines in the message), through the real app, Telegram front and browser.
const app = new App({ port: port(0), fakeClaude: true })
const stub = new TelegramStub(port(1))
const d = monthDates()
let stopBot: () => void
let page: Page

// Since the finance agent (2026-11-10) replies are free text: the retired "Based on" line, typed-figure
// refusals, five-round and three-minute limits are gone; their successors are in agent-controlled.spec.ts.
/** A run_query call, as a line of a script. */
const query = (...queries: string[]): [string, object] => ['run_query', { doing: 'Looking at the history', queries }]
const chartStep = (chart: object): [string, object] => ['show_chart', chart]
const say_ = (text: string) => `SCRIPT-SAY ${text}`
/** A message for the scripted model: the person's words, then what the model does. */
const steps = (words: string, ...lines: (string | [string, object])[]) => `${words}\n${script(...lines)}`

const backend = path.join(repo, 'backend')
/** What the query tool hands back for these statements: the tool's own views code (assistant/queries.Views), run
 *  against this app's database as a reply would. The scripted model cannot hand a whole result back, so the chat run
 *  proves the calls go through and change nothing, and this shows what they returned. */
async function viewResults(target: App, sqls: string[]): Promise<{ results: any[]; coverage: any }> {
  const code = [
    'import json, sys', 'from assistant import queries', 'v = queries.Views()',
    'try:', '    print(json.dumps({"results": [v.run(f"q{i + 1}", s) for i, s in enumerate(json.loads(sys.argv[1]))], "coverage": v.coverage_note()}, default=str))',
    'finally:', '    v.close()',
  ].join('\n')
  // Not execFileSync: blocking the event loop for seconds lets the app close a kept-alive connection under fetch.
  const { stdout } = await promisify(execFile)(path.join(backend, '.venv', 'bin', 'python'), ['-c', code, JSON.stringify(sqls)], {
    cwd: backend, maxBuffer: 64 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', DATABASE_URL: `sqlite:///${path.join(path.dirname(target.botDb), 'finance.db')}` },
  })
  return JSON.parse(stdout.trim().split('\n').at(-1)!)
}
/** The statements of every run_query line of a script, in order. */
const statementsOf = (lines: (string | [string, object])[]) => lines.flatMap(l => typeof l !== 'string' && l[0] === 'run_query' ? (l[1] as any).queries : [])
const ING_LINES = (rows: string[]) => [ING_HEADER, ...rows].join('\n') + '\n'
const rowLine = (date: string, description: string, euros: string, note = '') =>
  `"${date.replaceAll('-', '')}";"${description}";"NL";"";"BA";"Debit";"${euros}";"x";"${note}";"";""`

const proposals = async (channel: 'bubble' | 'telegram') =>
  (await app.conversation(channel)).messages.filter((m: any) => m.card)
/** Waits for the answer to this message, not for a queue that may simply not have heard of it yet. */
const replyTo = async (text: string) => {
  const after = (await app.conversation('bubble')).messages.at(-1)?.id ?? 0
  await say(page, text)
  let reply: any
  await expect.poll(async () => {
    const { messages } = await app.conversation('bubble')
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

  test.beforeEach(clear)

  test('R-002: "how are we doing" needs no lookup, and the snapshot of this month does not grow with history', async () => {
    await app.addRule('sample older', 'Miscellaneous')
    const ask = steps('How are we doing this month?', 'SCRIPT-ECHO', say_('Left: plenty.'))
    const first = await replyTo(ask)
    await expect(page.locator('.bk-reply').last()).toContainText('Left: plenty.')
    // One run, with no lookup: the live log of the question stayed empty.
    const asked = (await app.conversation('bubble')).messages.find((m: any) => m.id === first.reply_to)
    expect(asked.steps).toEqual([])
    const contextOf = (prompt: string) => JSON.parse(/<context>\n([\s\S]*?)\n<\/context>/.exec(prompt)![1])
    const before = contextOf(first.text)
    expect(before.this_month.month).toBe(d.label)
    expect(before.this_month.left_in_plan_cents).toBe((await app.json('/dashboard/pace')).spendable_plan_cents - (await app.json('/dashboard/pace')).spendable_actual_cents)

    await app.importCsv(ING_LINES(Array.from({ length: 20 }, (_, i) => rowLine(d.backDay(12 + i, 2), `Sample Older ${i}`, '12,00'))))
    await clear()
    const again = await replyTo(ask)
    expect(contextOf(again.text).this_month).toEqual(before.this_month)
    expect(again.text.length).toBeLessThan(20_000)
  })

  test('R-002 R-001: "last 12 months" fetches the months it needs, and the oldest imported month can be reached', async () => {
    const oldest = d.back(31)
    const lines: [string, object][] = [
      query(`SELECT month, SUM(spent_cents) AS spent_cents FROM category_months WHERE month >= '${d.back(13)}' GROUP BY month ORDER BY month`),
      query(`SELECT month, COUNT(*) AS n FROM spending WHERE month = '${oldest}' GROUP BY month`),
    ]
    const reply = await replyTo(steps('What did the last 12 months look like?', ...lines, say_('Looked back.')))
    expect(reply.text).toBe('Looked back.')
    const [months, reached] = (await viewResults(app, statementsOf(lines))).results
    expect(months.rows.map((r: any) => r[0])).toEqual(expect.arrayContaining([d.back(5), d.back(12)]))
    expect(reached.rows).toEqual([[oldest, 1]])
    expect(await proposals('bubble')).toHaveLength(0)
  })

  test('R-003: writes, structure changes and second statements are refused, and nothing changes', async () => {
    const before = await ledger()
    const rulesBefore = await app.json('/rules')
    const statements = [
      'INSERT INTO transactions (id) VALUES (999)', 'UPDATE transactions SET amount_cents = 1', 'DELETE FROM transactions',
      'DELETE FROM category_months', 'DROP TABLE transactions', 'CREATE TABLE stolen (a)',
      'ALTER TABLE spending ADD COLUMN x', 'SELECT 1; DELETE FROM transactions', 'CREATE TEMP VIEW sneaky AS SELECT 1',
      'PRAGMA query_only = OFF', "ATTACH DATABASE 'finance.db' AS real", "REPLACE INTO coverage (month) VALUES ('x')",
      "SELECT load_extension('evil')", 'SELECT count(*) FROM sqlite_master', "SELECT count(*) FROM pragma_table_info('transactions')",
    ]
    const rounds: [string, object][] = []
    for (let i = 0; i < statements.length; i += 3) rounds.push(query(...statements.slice(i, i + 3)))
    // With no closing words the reply is the tool results themselves: five run_query calls went through.
    const reply = await replyTo(steps('Please delete everything', ...rounds))
    expect(reply.text.split('\n').filter((l: string) => l.startsWith('- run_query'))).toHaveLength(5)
    const { results } = await viewResults(app, statements)
    expect(results).toHaveLength(statements.length)
    for (const result of results) {
      expect(result.error, result.id).toBeTruthy()
      expect(result.rows, result.id).toBeUndefined()
    }
    expect(await ledger()).toEqual(before)
    expect(await app.json('/rules')).toEqual(rulesBefore)
  })

  test('R-004: chat messages, cards, settings and the real tables cannot be reached; the set-up views are app-made copies', async () => {
    // The chat's own store (bot_messages, bot_cards) is a separate file now; the old chat tables are gone too.
    const off = ['chat_messages', 'chat_proposals', 'bot_messages', 'bot_cards', 'settings', 'transaction_splits', 'sqlite_master', 'sqlite_schema', 'alembic_version']
    const rounds: [string, object][] = []
    for (let i = 0; i < off.length; i += 3) rounds.push(query(...off.slice(i, i + 3).map(t => `SELECT * FROM ${t}`)))
    rounds.push(query('SELECT * FROM rules', 'SELECT * FROM categories'))
    await replyTo(steps('Read the chat log', ...rounds, say_('Those are not mine to read.')))
    const { results } = await viewResults(app, statementsOf(rounds))
    expect(results).toHaveLength(off.length + 2)
    for (const result of results.slice(0, off.length)) expect(result.error, result.id).toMatch(/no such table|prohibited|not authorized/i)
    const [rules, categories] = results.slice(off.length)
    expect(rules.rows.map((r: any) => r[1]).sort()).toEqual((await app.json<any[]>('/rules')).map(r => r.pattern).sort())
    expect(categories.rows.map((r: any) => r[1])).toEqual((await app.json<any[]>('/categories')).map(c => c.name))
  })

  /** Months further back than any page opens, so a saved row there could only come from looking. */
  async function expectViewsEqualMonthPage(unopened?: string) {
    const range = `(month >= '${d.back(10)}' OR month = '${d.back(14)}')`
    const lines: [string, object][] = [query(`SELECT * FROM category_months WHERE spent_cents <> 0 AND ${range}`, `SELECT * FROM month_totals WHERE ${range}`, `SELECT month, category, SUM(spend_cents) AS s FROM spending WHERE ${range} AND category_type IN ('needs','wants','savings') AND counts_as IN ('spend','refund') GROUP BY month, category`)]
    const before = await ledger()
    const budgetsBefore = app.dump().budgets
    await replyTo(steps('compare', ...lines, say_('Compared.')))
    expect(await ledger(), 'looking changed the ledger').toEqual(before)
    if (unopened) expect(app.dump().budgets, 'an unvisited month got a plan by looking').toEqual(budgetsBefore)
    const [byCategory, totals, spending] = (await viewResults(app, statementsOf(lines))).results
    expect(byCategory.cut_off).toBe(false)
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

  test('R-004: the views equal the Month page with a split, a refund, an excluded row and a moved month start', async () => {
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
    await expectViewsEqualMonthPage(d.back(14))
    expect(await budgetCents(d.back(2), 'Clothing')).toBe(3000)

    await setStart('5')
    await clear()
    await expectViewsEqualMonthPage()
    await setStart('24')
  })

  test('R-005: a query for the whole ledger is capped and marked cut off, so the agent is told', async () => {
    await app.importCsv(ING_LINES(Array.from({ length: 260 }, (_, i) => rowLine(d.backDay(8, 10), `Sample Gym extra ${i}`, '1,00', String(i)))))
    const reply = await replyTo(steps('Give me the whole ledger', query('SELECT * FROM transactions')))
    // What the model was handed: cut off, with the note saying so.
    expect(reply.text).toMatch(/^- run_query: /)
    const [result] = (await viewResults(app, ['SELECT * FROM transactions'])).results
    expect(result.rows).toHaveLength(200)
    expect(result.cut_off).toBe(true)
    expect(result.note).toContain('Cut off')
  })

  test('R-005: runaway queries end at their time limit, single long steps end at once, odd numbers do no harm', async () => {
    const big = `printf('%.*c', 999000, 'a')`
    const lines: [string, object][] = [
      query('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT max(n) FROM r'),
      query(`SELECT glob('*' || ${big} || 'b', ${big})`, `SELECT ${big} LIKE '%' || ${big} || 'b'`, `SELECT instr(${big} || ${big}, ${big} || 'b')`),
      query('SELECT 9e999 AS x'),
    ]
    const started = Date.now()
    const reply = await replyTo(steps('Stall on purpose', ...lines, say_('That could not be worked out.')))
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(reply.text).toContain('That could not be worked out.')
    const { results } = await viewResults(app, statementsOf(lines))
    expect(results[0].error).toContain('Stopped after 2 seconds')
    expect(results.at(-1).rows).toEqual([[null]])
  })

  test('R-009 (agent R-004): months with no data and months before the first import are in what the agent is told', async () => {
    const lines: [string, object][] = [query(`SELECT month FROM coverage WHERE month = '${d.back(7)}'`)]
    await replyTo(steps('Groceries over the last 40 months?', ...lines, say_('Looked.')))
    const { coverage } = await viewResults(app, statementsOf(lines))
    expect(coverage.months_with_gaps.some((m: any) => m.month === d.back(7) && m.status === 'no data')).toBe(true)
    expect(coverage.first_month).toBe(d.back(31)) // the oldest row, imported by the first test
  })

  test('R-009 (agent R-004): the agent is told when the bank files stop early or leave a hole', async () => {
    const other = new App({ port: port(2), fakeClaude: true })
    await other.start()
    try {
      await other.useRunner('script', 'script', 'bubble')
      await other.addRule('sample card', 'Miscellaneous')
      const ingRows: string[] = []
      for (let back = 3; back >= 1; back--) {
        for (let day = 0; day <= 28; day += 3) {
          const stopped = back === 2 && day > 6
          const hole = back === 3 && day > 3 && day < 24
          if (!stopped && !hole) ingRows.push(ingRow(d.backDay(back, day), 'Sample Card', -500, `c${back}-${day}`))
        }
      }
      await other.importCsv(ING_LINES(ingRows))
      const lines: [string, object][] = [query(`SELECT SUM(spent_cents) AS spent_cents FROM category_months WHERE category = 'Miscellaneous' AND month = '${d.back(1)}'`)]
      await other.post('/chat/messages', { channel: 'bubble', text: steps('How did it go?', ...lines, say_('Steady.')) })
      await expect.poll(async () => (await other.conversation('bubble')).messages.at(-1).role, { timeout: 30_000 }).toBe('assistant')
      const gaps = (await viewResults(other, statementsOf(lines))).coverage.months_with_gaps
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
  const chartRun = (words: string, spec: object = SPEC) => steps(words, query(CHART_SQL()), chartStep(spec), say_('Food and Miscellaneous over five months.'))
  const image = (id: number, theme = 'day') => fetch(`${app.base}/api/chat/messages/${id}/image?theme=${theme}`).then(async r => Buffer.from(await r.arrayBuffer()))

  test('R-011: a chart reaches both chats next to the text, from the numbers the query returned', async () => {
    const reply = await replyTo(chartRun('show spend per category over 5 months'))
    const chart = reply.payload.chart
    const [result] = (await viewResults(app, [CHART_SQL()])).results
    expect(chart.labels).toEqual([d.back(5), d.back(4), d.back(3), d.back(2), d.back(1)])
    for (const series of chart.series) {
      expect(series.values).toEqual(chart.labels.map((m: string) => result.rows.find((r: any) => r[0] === m && r[1] === series.name)[2]))
      for (const [i, month] of chart.labels.entries()) expect(series.values[i]).toBe(await budgetCents(month, series.name))
    }
    const picture = page.locator('.bk-image:visible').last()
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(400)
    await picture.scrollIntoViewIfNeeded()
    await shot(page, 'insight-chart-desktop')
    const png = await image(reply.id)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const night = await image(reply.id, 'night')
    expect(night.equals(png)).toBe(false)

    const count = stub.sent.length
    const photos = stub.photos.length
    stub.text(DANIEL, chartRun('show spend per category over 5 months'))
    await stub.reply_after(count, m => m.text === 'Food and Miscellaneous over five months.')
    await expect.poll(() => stub.photos.length, { timeout: 20_000 }).toBe(photos + 1)
    expect(stub.photos.at(-1)!.chat_id).toBe(String(GROUP))
    const telegramReply = (await app.conversation('telegram')).messages.at(-1)
    const telegramPng = await image(telegramReply.id)
    expect(stub.photos.at(-1)!.body.includes(telegramPng)).toBe(true)
    await expect.poll(async () => (await app.json('/chat/outbox?channel=telegram')).replies.length).toBe(0)
  })

  test('R-011: a legend with many long names fits inside the picture', async () => {
    const wide = `SELECT month, category || ' with a long extra name' AS name, spent_cents FROM category_months WHERE month BETWEEN '${d.back(5)}' AND '${d.back(1)}' ORDER BY month, name`
    const reply = await replyTo(steps('show all categories over 5 months', query(wide), chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', series: 'name', title: 'Spending per category' }), say_('All categories.')))
    expect(reply.payload.chart.series.length).toBeGreaterThanOrEqual(6)
    expect(reply.payload.chart.series.at(-1).name).toBe('Other')
    expect(reply.payload.chart.unit).toBe('cents')
    const picture = page.locator('.bk-image:visible').last()
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(400)
    await picture.scrollIntoViewIfNeeded()
    await shot(page, 'insight-chart-legend-desktop')
    // Text cut off by the picture's edge leaves ink in its outermost columns and rows.
    const edgesClear = await picture.evaluate((el: HTMLImageElement) => {
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
    // No closing words, so the reply lists what each tool said: the chart tool's refusal is what the model is told.
    const lookup = `SELECT month, spent_cents FROM category_months WHERE month = '${d.back(1)}' AND category = 'Food - Essential'`
    const photos = stub.photos.length
    const reply = await replyTo(steps('Groceries last month, one number?', query(lookup), chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents' })))
    expect(reply.text).toMatch(/- show_chart \(error\): There is only one number there/)
    expect(reply.payload.chart).toBeUndefined()
    await expect(page.locator('.bk-image')).toHaveCount(0)
    expect(stub.photos.length).toBe(photos)

    for (const bad of [
      { type: 'bars', query: 'q9', x: 'month', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'nonsense', y: 'spent_cents' },
      { type: 'bars', query: 'q1', x: 'month', y: 'category', series: 'category' },
    ]) {
      await clear()
      const told = await replyTo(steps('show spend per category over 5 months', query(CHART_SQL()), chartStep(bad)))
      expect(told.text, JSON.stringify(bad)).toMatch(/- show_chart \(error\): .*(cannot be drawn|could not be drawn)/)
      expect(told.payload.chart).toBeUndefined()
      // And with words: the words go out, with no picture.
      await clear()
      const words = await replyTo(steps('show spend per category over 5 months', query(CHART_SQL()), chartStep(bad), say_('The chart could not be made this time, but Food came first.')))
      expect(words.text).toContain('Food came first')
      expect(words.payload.chart).toBeUndefined()
    }

    await clear()
    const cut = await replyTo(steps('chart the whole ledger', query('SELECT * FROM transactions'), chartStep({ type: 'line', query: 'q1', x: 'date', y: 'amount_cents' })))
    expect(cut.text).toMatch(/- show_chart \(error\): .*cut off/)
    expect(cut.payload.chart).toBeUndefined()
  })

  test('R-011: when Telegram refuses the picture the words stay and are not sent twice', async () => {
    const count = stub.sent.length
    stub.failPhotos = true
    try {
      stub.text(DANIEL, chartRun('show spend per category over 5 months'))
      expect(await stub.reply_after(count, m => m.text.includes('chart could not be sent'))).toBeTruthy()
    } finally {
      stub.failPhotos = false
    }
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect(stub.sent.slice(count).filter(m => m.text === 'Food and Miscellaneous over five months.')).toHaveLength(1)
  })

  test('R-011: after New chat the new chart is shown, never the old picture', async () => {
    const chartFor = (words: string, category: string, title: string) => steps(words,
      query(`SELECT month, spent_cents FROM category_months WHERE category = '${category}' AND month BETWEEN '${d.back(3)}' AND '${d.back(1)}' ORDER BY month DESC`),
      chartStep({ type: 'bars', query: 'q1', x: 'month', y: 'spent_cents', title }),
      say_('Latest month first.'))
    const first = await replyTo(chartFor('Chart the food', 'Food - Essential', 'Food'))
    expect(first.payload.chart.labels).toEqual([d.back(3), d.back(2), d.back(1)])
    const firstSrc = await page.locator('.bk-image:visible').last().getAttribute('src')

    await clear()
    await expect(page.locator('.bk-image')).toHaveCount(0)
    const second = await replyTo(chartFor('Chart the rest', 'Miscellaneous', 'Other things'))
    const picture = page.locator('.bk-image:visible').last()
    await expect(picture).toBeVisible()
    expect(await picture.getAttribute('src')).not.toBe(firstSrc)
    const shown = await picture.evaluate(async (el: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(el.currentSrc, { cache: 'force-cache' })).arrayBuffer())))
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    const current = await image(second.id, theme ?? 'day')
    expect(Buffer.from(shown).equals(current)).toBe(true)
  })
})
