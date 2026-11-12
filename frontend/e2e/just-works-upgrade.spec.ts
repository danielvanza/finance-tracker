/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { App, DANIEL, GROUP, PARTNER, TelegramStub, euro, ingCsv, ingRow, monthDates, openChat, repo, say, startBot } from './fixtures'

// "Just works for two": what happens to a household that already uses the app (its database is made by the
// release before this feature, then opened by this one), and what the bot says without being asked.
const backend = path.join(repo, 'backend')
const python = path.join(backend, '.venv', 'bin', 'python')
const BEFORE = '1318268' // the release before this feature

const isQuestion = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Something else')
const labels = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.text)
const sure = (index: number, category: string) => ({ index, category, sure: true })
const unsure = (index: number, category: string, options: string[] = []) => ({ index, category, sure: false, options })

test.describe.serial('just works for two: a household that already uses the app', () => {
  const app = new App({ port: 18771, fakeClaude: true })
  const stub = new TelegramStub(18772)
  const d = monthDates()
  const old = mkdtempSync(path.join(tmpdir(), 'hf-before-'))
  let stopBot: () => void
  let page: Page
  let before: any

  test.beforeAll(async ({ browser }) => {
    // The release before this feature makes the database, seeds it and is used the way the household used it.
    execFileSync('sh', ['-c', `git -C "${repo}" archive ${BEFORE} backend | tar -x -C "${old}"`])
    const dbFile = path.join((app as any).dir, 'finance.db')
    const script = `
import json, sqlite3, sys, io
import main
from fastapi.testclient import TestClient
c = TestClient(main.app)
cats = {x["name"]: x["id"] for x in c.get("/categories").json()}
assert "Refunds" in cats and "Personal Allowance" in cats and "Retained Salary" in cats
for pattern, name in (("albert heijn", "Food - Essential"), ("salaris voorbeeld", "Salary"), ("sample energy", "Utilities")):
    assert c.post("/rules", json={"pattern": pattern, "category_id": cats[name], "priority": 3}).status_code == 200
head = '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"'
def row(day, name, cents, note=""):
    amount = f"{abs(cents) / 100:.2f}".replace(".", ",")
    side = "Debit" if cents < 0 else "Credit"
    return f'"{day.replace("-", "")}";"{name}";"NL57INGB0000000000";"";"BA";"{side}";"{amount}";"Payment terminal";"{note}";"";""'
rows = ${JSON.stringify([
      [d.inMonth(0), 'Salaris Voorbeeld BV', 300000, 'pay'],
      [d.inMonth(1), 'Albert Heijn 1234', -4200, 'ah one'],
      [d.inMonth(2), 'Sample Energy NV', -14500, 'energy'],
      [d.backDay(1, 0), 'Salaris Voorbeeld BV', 300000, 'pay before'],
      [d.backDay(1, 3), 'Albert Heijn 1234', -6100, 'ah before'],
    ])}
csv = head + "\\n" + "\\n".join(row(*r) for r in rows) + "\\n"
done = c.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", csv)})
assert done.status_code == 200 and done.json()["categorised_by_rule"] == 5, done.text
# Opening the month makes the release invent its two allowance payments, as it did every month.
assert c.get("/dashboard/pace").status_code == 200
# Money booked in the old "Refunds" income category, in the month before.
refund = c.post("/transactions", json={"date": "${d.backDay(1, 6)}", "amount_cents": 2500, "description": "Sample Webshop Retour", "category_id": cats["Refunds"]})
assert refund.status_code == 201, refund.text
db = sqlite3.connect(sys.argv[1])
def put(day, cents, name, category, confirmed, by):
    db.execute("INSERT INTO transactions (date, amount, description, source, category_id, confirmed, categorised_by, ai_confidence, import_hash, is_refund) VALUES (?,?,?,?,?,?,?,?,?,0)",
               (day, cents / 100, name, "ing", category, confirmed, by, 0.7, name + day))
# The pile that waited for review: guesses nobody had confirmed, one of them in the allowance category.
put("${d.inMonth(9)}", -1800, "Sample Bakery Corner", cats["Food - Not Essential"], 0, "ai")
put("${d.inMonth(8)}", -5500, "Sample Filling Station", cats["Transportation"], 0, "ai")
put("${d.inMonth(7)}", -4000, "Mw Q Voorbeeld", cats["Personal Allowance"], 0, "ai")
put("${d.inMonth(6)}", -900, "Onbekend Kiosk", cats["Miscellaneous"], 0, "ai")
put("${d.inMonth(5)}", 1500, "Sample Shoe Shop Retour", cats["Refunds"], 0, "ai")
# And one a person had confirmed.
put("${d.inMonth(4)}", -3300, "Sample Reviewed Shop", cats["Clothing"], 1, "ai")
db.commit()
out = {"rules": c.get("/rules").json(), "categories": c.get("/categories").json()}
for month in ("${d.label}", "${d.previous}"):
    out[month] = {"summary": c.get("/dashboard/summary", params={"month": month}).json(), "budget": c.get("/budget", params={"month": month}).json()}
out["invented"] = [t for t in c.get("/transactions").json() if t["standing_adjustment_id"] is not None]
print("RESULT" + json.dumps(out))
`
    const output = execFileSync(python, ['-c', script, dbFile], {
      cwd: path.join(old, 'backend'), encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', DATABASE_URL: `sqlite:///${dbFile}` },
    })
    before = JSON.parse(output.split('RESULT')[1])
    expect(before.invented.map((t: any) => t.amount_cents).sort((a: number, b: number) => a - b)).toEqual([-60000, -60000, 60000, 60000])

    // This release opens that database. What it asks Claude at startup about the waiting pile is scripted:
    // the pile newest first is bakery, filling station, Mw Q Voorbeeld, kiosk, shoe shop refund, webshop refund.
    // Midday, whatever the hour the check runs at: at night the app keeps its questions for the morning.
    app.clock(`${d.today}T12:00`)
    mkdirSync(path.join(app.home, 'work'), { recursive: true })
    app.fake({ mode: 'reply', delay: '0', plain: JSON.stringify([
      sure(0, 'Food - Not Essential'),
      sure(1, 'Transportation'),
      unsure(2, 'Miscellaneous', ['To personal accounts', 'Miscellaneous']),
      unsure(3, 'Miscellaneous', ['Miscellaneous', 'Food - Not Essential']),
      unsure(4, 'Other Income', ['Clothing', 'Other Income']),
      unsure(5, 'Other Income', ['Clothing']),
    ]) })
    await app.start()
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  })

  test.afterAll(async () => {
    stopBot()
    await stub.stop()
    await app.stop()
    app.destroy()
    rmSync(old, { recursive: true, force: true })
  })

  test('R-015: standing adjustments and their invented payments are gone, and no total changed except by those payments', async () => {
    // The pile is judged when the app starts; wait for that, so the comparison below stands still.
    await expect.poll(async () => (await app.transactions()).find(t => t.description === 'Sample Bakery Corner').confirmed, { timeout: 30_000 }).toBe(true)
    const after = await app.transactions()
    expect(after.filter(t => t.description.startsWith('Personal allowance'))).toEqual([])
    expect(after.length, 'the five bank rows, the manual refund and the six rows put in by hand; the four invented rows went').toBe(12)
    for (const gone of ['/standing-adjustments', '/transactions/adjustment-pair']) {
      expect((await fetch(`${app.base}/api${gone}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBeGreaterThanOrEqual(404)
      expect((await fetch(`${app.base}/api${gone}`)).status).toBeGreaterThanOrEqual(404)
    }
    expect(app.value("SELECT name FROM sqlite_master WHERE name = 'standing_adjustments'")).toEqual([])
    expect(app.value("SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name = 'standing_adjustment_id'")).toEqual([[0]])

    // This month: income and spending are lower by exactly the invented €1.200 each, and nothing else moved.
    // (The sure guesses of the pile count from now on; they are taken out again for this comparison.)
    const was = before[d.label].summary
    const now = await app.json<any>(`/dashboard/summary?month=${d.label}`)
    const newlyCounted = 1800 + 5500
    expect(now.total_income_cents).toBe(was.total_income_cents - 120000)
    expect(now.total_expenses_cents - newlyCounted).toBe(was.total_expenses_cents - 120000)
    expect(now.left_over_cents + newlyCounted, 'what is left over is as it was').toBe(was.left_over_cents)
    const spent = (summary: any, name: string) => summary.category_breakdown.find((c: any) => c.category_name === name)?.actual_cents ?? 0
    for (const name of ['Food - Essential', 'Utilities', 'Clothing', 'Taxes & Mortgage']) expect(spent(now, name), name).toBe(spent(was, name))
    expect(spent(was, 'Personal Allowance')).toBe(120000)
    const plan = (rows: any[], name: string) => rows.find((r: any) => r.category_name === name)?.planned_amount_cents
    const budgetNow = await app.json<any[]>(`/budget?month=${d.label}`)
    for (const row of before[d.label].budget.filter((r: any) => r.category_name !== 'Personal Allowance')) {
      expect(plan(budgetNow, row.category_name), `plan for ${row.category_name}`).toBe(row.planned_amount_cents)
    }

    // The allowance category still held a real payment, so it lives on as "To personal accounts", without
    // the part of its plan that only covered the invented payments. The unused income category is gone.
    const names = (await app.json<any[]>('/categories')).map(c => c.name)
    expect(names).not.toContain('Personal Allowance')
    expect(names).not.toContain('Retained Salary')
    expect(await app.category('To personal accounts')).toMatchObject({ type: 'wants' })
    expect(plan(budgetNow, 'To personal accounts')).toBe(0)
    expect((await app.transactions()).find(t => t.description === 'Mw Q Voorbeeld').category_name).not.toBe('Personal Allowance')

    // Nothing in the app offers them any more: Setup, Add transaction, or the chat.
    await page.goto(`${app.base}/setup`)
    await expect(page.getByRole('heading', { name: 'Set-asides' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/standing adjustment/i)
    await page.goto(`${app.base}/transactions`)
    await page.locator('.page-actions').getByRole('button', { name: 'Add transaction' }).click()
    await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeVisible()
    await expect(page.locator('.sheet')).not.toContainText(/adjustment pair|pair/i)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await openChat(page)
    for (const op of ['standing.add', 'adjustment_pair.add', 'transaction.rule']) {
      app.script([
        { reply: { kind: 'propose', summary: 'Try it.', op, args: { name: 'x', amount_cents: 100, date: d.today, description: 'x', legs: [], id: 1 } } },
        { reply: { kind: 'answer', text: `No ${op}.` } },
      ])
      await say(page, `try ${op}`)
      await expect(page.locator('.chat-reply', { hasText: `No ${op}.` })).toBeVisible()
      expect(app.toolCalls().at(-1)).toMatchObject({ isError: true })
      expect(app.toolCalls().at(-1)!.text).toContain(`there is no change called '${op}'`)
    }
    await expect(page.locator('.chat-card[data-state="pending"]')).toHaveCount(0)
  })

  test('R-024: the "Refunds" income category is gone and its payments wait again, to be booked as refunds', async () => {
    expect((await app.json<any[]>('/categories')).map(c => c.name)).not.toContain('Refunds')
    const webshop = (await app.transactions()).find(t => t.description === 'Sample Webshop Retour')
    expect(webshop).toMatchObject({ confirmed: false, is_refund: false, amount_cents: 2500 })
    const shoes = (await app.transactions()).find(t => t.description === 'Sample Shoe Shop Retour')
    expect(shoes).toMatchObject({ confirmed: false, is_refund: false })
    // They no longer count as income in their month.
    const was = before[d.previous].summary
    const now = await app.json<any>(`/dashboard/summary?month=${d.previous}`)
    expect(now.total_income_cents).toBe(was.total_income_cents - 2500)
    expect(now.total_expenses_cents).toBe(was.total_expenses_cents)
    // A fresh household has no such category either.
    const fresh = new App({ port: 18773, fakeClaude: true })
    await fresh.start()
    try {
      const names = (await fresh.json<any[]>('/categories')).map(c => c.name)
      for (const gone of ['Refunds', 'Personal Allowance', 'Retained Salary']) expect(names).not.toContain(gone)
      expect(names).toContain('To personal accounts')
      expect((await fresh.json<any>('/settings')).target_split).toBe('50/30/20')
    } finally {
      await fresh.stop()
      fresh.destroy()
    }
  })

  test('R-014 R-023: the pile that was waiting is judged without importing again, its questions clear it from Telegram alone, and the old rules sort as before', async () => {
    // Sure ones count; a guess a person had already confirmed is theirs, not "automatic".
    const find = async (name: string) => (await app.transactions()).find(t => t.description === name)
    await expect.poll(async () => (await find('Sample Bakery Corner')).confirmed, { timeout: 30_000 }).toBe(true)
    expect(await find('Sample Bakery Corner')).toMatchObject({ categorised_by: 'ai', category_name: 'Food - Not Essential' })
    expect(await find('Sample Filling Station')).toMatchObject({ confirmed: true, categorised_by: 'ai', category_name: 'Transportation' })
    expect(await find('Sample Reviewed Shop')).toMatchObject({ confirmed: true, categorised_by: 'manual', category_name: 'Clothing' })
    const waiting = async () => (await app.json<any>('/dashboard/pace')).to_review
    expect(await waiting()).toBe(4)

    // The rest arrive as grouped questions, and answering them brings the number waiting to zero.
    const open = () => stub.sent.filter(m => !m.deleted && m.chat_id === GROUP && isQuestion(m))
    await expect.poll(() => open().length, { timeout: 30_000 }).toBe(3)
    expect(open().map(m => m.text.split(' · ')[0]).sort()).toEqual(['Mw Q Voorbeeld', 'Sample Shoe Shop Retour', 'Sample Webshop Retour'])
    expect(labels(open().find(m => m.text.startsWith('Mw Q Voorbeeld')))).toEqual(['Miscellaneous', 'To personal accounts', 'Something else'])
    expect(labels(open().find(m => m.text.startsWith('Sample Shoe Shop Retour')))).toEqual(['Other Income', 'Refund: Clothing', 'Something else'])
    let presses = 0
    for (let round = 0; round < 10 && (await waiting()) > 0; round++) {
      const question = open()[0]
      const choice = labels(question).find((l: string) => l.startsWith('Refund:') || l === 'To personal accounts') ?? labels(question)[0]
      stub.tap(round % 2 ? DANIEL : PARTNER, question, stub.button(question, choice))
      await expect.poll(() => isQuestion(question), { timeout: 15_000 }).toBe(false)
      presses++
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    expect(await waiting(), 'nothing is left waiting').toBe(0)
    expect(presses).toBe(4)
    expect(open()).toHaveLength(0)
    expect(await find('Mw Q Voorbeeld')).toMatchObject({ confirmed: true, category_name: 'To personal accounts' })
    expect(await find('Sample Shoe Shop Retour')).toMatchObject({ confirmed: true, is_refund: true, category_name: 'Clothing' })
    expect(await find('Sample Webshop Retour')).toMatchObject({ confirmed: true, is_refund: true, category_name: 'Clothing' })
    expect((await app.json<any[]>('/transactions?confirmed=false'))).toEqual([])

    // The rules made before sort the same payments as before, with their priority gone.
    const rules = await app.json<any[]>('/rules')
    for (const rule of before.rules) expect(rules.find(r => r.pattern === rule.pattern)).toMatchObject({ category_id: rule.category_id })
    expect(rules.every(r => !('priority' in r))).toBe(true)
    const again = await app.importCsv(ingCsv([
      ingRow(d.inMonth(1), 'Albert Heijn 1234', -4200, 'ah one'),
      ingRow(d.inMonth(3), 'Albert Heijn 1234', -1500, 'ah new'),
    ]))
    expect(again).toMatchObject({ imported: 1, skipped_duplicates: 1, categorised_by_rule: 1 })
    expect((await app.transactions()).filter(t => t.description === 'Albert Heijn 1234').every(t => t.category_name === 'Food - Essential' && t.categorised_by === 'rule')).toBe(true)
  })
})

test.describe.serial('just works for two: what the bot says without being asked', () => {
  // The app's clock is moved by hand; it looks every second whether something is due.
  const app = new App({ port: 18775, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
  const stub = new TelegramStub(18776)
  let stopBot: () => void
  const said = () => stub.sent.filter(m => m.chat_id === GROUP)
  const settle = () => new Promise(resolve => setTimeout(resolve, 4500))
  const newest = async (count: number, n: number) => {
    await expect.poll(() => said().length, { timeout: 20_000 }).toBe(count + n)
    await settle()
    expect(said().length, 'each message once').toBe(count + n)
    return said().slice(count).map(m => m.text)
  }
  const month = (label?: string) => app.json<any>(`/dashboard/pace${label ? `?month=${label}` : ''}`)
  const daily = (from: string, days: number, name: string, cents: number) => Array.from({ length: days }, (_, i) => {
    const day = new Date(`${from}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() + i)
    return ingRow(day.toISOString().slice(0, 10), name, cents, `${name} ${from} ${i}`)
  })

  test.beforeAll(async () => {
    app.clock('2026-11-14T12:00') // a Saturday
    await app.start()
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await app.addRule('salaris voorbeeld', 'Salary')
    await app.addRule('albert heijn', 'Food - Essential')
    await app.addRule('sample bistro', 'Food - Not Essential')
    await app.importCsv(ingCsv([
      ingRow('2026-10-24', 'Salaris Voorbeeld BV', 300000, 'pay'),
      ...daily('2026-10-25', 20, 'Albert Heijn 1234', -2000), // to 13 Nov
      ingRow('2026-11-10', 'Sample Bistro', -31000, 'a big dinner'),
    ]))
  })

  test.afterAll(async () => {
    stopBot()
    await stub.stop()
    await app.stop()
    app.destroy()
  })

  test('R-008 R-010: the weekly recap comes once on Sunday evening, at most six lines, with the Month page\'s figures', async () => {
    await settle()
    expect(said(), 'nothing is owed for the time before the app said such things').toHaveLength(0)
    app.clock('2026-11-15T17:59')
    await settle()
    expect(said()).toHaveLength(0)
    app.clock('2026-11-15T18:00')
    const [recap] = await newest(0, 1)
    const p = await month()
    const lines = recap.split('\n')
    expect(lines.length).toBeLessThanOrEqual(6)
    expect(lines[0]).toBe('This week\'s recap.')
    expect(lines[1]).toBe(`Free to spend until payday: ${euro(p.free.free_cents)}, about ${euro(p.free.per_day_cents)} a day for 9 days.`)
    // One or two things that stood out: the category over its plan.
    expect(lines.slice(2).join('\n')).toContain('Food - Not Essential is €110,00 over its plan (€310,00 of €200,00).')
    // The same evening, an hour on, and after a restart: not again.
    app.clock('2026-11-15T19:30')
    await settle()
    await app.stop()
    await app.start()
    await settle()
    expect(said()).toHaveLength(1)
  })

  test('R-007 R-008 R-010: nothing is sent at night; in the morning the missed recap and the old-data nudge come as one message, with no figures when the data is old', async () => {
    const count = said().length
    // The next Sunday at 21:30: the recap was missed, and the bank data (to 13 Nov) is nine days old.
    app.clock('2026-11-22T21:30')
    await settle()
    expect(said().length, 'not after 21:00').toBe(count)
    app.clock('2026-11-23T03:00')
    await settle()
    app.clock('2026-11-23T08:59')
    await settle()
    expect(said().length, 'not before 9:00').toBe(count)
    app.clock('2026-11-23T09:00')
    // Both are owed, and arrive as one message: the recap of old data already says where the data stops and what to send.
    const [owed] = await newest(count, 1)
    expect(owed).toBe('This week\'s recap: I cannot say how the month is going, because the bank data stops at 13 Nov.\nSend a new ING export here and I will catch up.')
    expect(owed).not.toContain('€')
    expect(app.value("SELECT value FROM settings WHERE key = 'nudge_stale'"), 'the old-data nudge counts as said').toEqual([['2026-11-23T09:00|2026-11-13']])
    // Not repeated the next days.
    app.clock('2026-11-23T15:00')
    await settle()
    expect(said().length).toBe(count + 1)
  })

  test('R-009: on the first day of a financial month, a few lines say how the last one ended, and that its data is incomplete when it is', async () => {
    const count = said().length
    app.clock('2026-11-24T08:30')
    await settle()
    expect(said().length).toBe(count)
    app.clock('2026-11-24T09:00')
    const [close] = await newest(count, 1)
    const november = await month('2026-11')
    const lines = close.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(lines[0]).toBe('November has ended.')
    expect(lines[1]).toBe(`Spent ${euro(november.spendable_actual_cents)} of the ${euro(november.spendable_plan_cents)} planned: ${euro(november.spendable_plan_cents - november.spendable_actual_cents)} under.`)
    expect(lines[2]).toBe('Income was €3.000,00, and €0,00 went to savings.')
    expect(lines[3]).toBe('The bank data only runs to 13 Nov, so the last days of the month are missing from this.')
  })

  test('R-007: the old-data nudge is not repeated until seven more days have passed or a file was imported', async () => {
    let count = said().length
    app.clock('2026-11-27T12:00') // four days after it was said
    await settle()
    expect(said().length).toBe(count)
    // A file is imported that still leaves the data old: it says how far the data runs now.
    await app.importCsv(ingCsv(daily('2026-11-14', 3, 'Albert Heijn 1234', -2000))) // to 16 Nov
    const [afterImport] = await newest(count, 1)
    expect(afterImport).toBe('The bank data stops at 16 Nov, 11 days ago. Send a new ING export here when you can, and I will bring the month up to date.')
    // Seven days on with nothing imported it is due again. On its own (a Thursday, no recap owed) it comes by itself.
    count = said().length
    app.sql("UPDATE settings SET value = '2026-11-29T18:00' WHERE key = 'nudge_recap'") // as if that Sunday's recap had gone out
    app.clock('2026-12-04T11:00')
    await settle()
    expect(said().length, 'an hour short of seven days: not yet').toBe(count)
    app.clock('2026-12-04T12:05')
    const [again] = await newest(count, 1)
    expect(again).toBe('The bank data stops at 16 Nov, 18 days ago. Send a new ING export here when you can, and I will bring the month up to date.')
    // Once the data is fresh again, nothing is said about it.
    count = said().length
    await app.importCsv(ingCsv([ingRow('2026-11-24', 'Salaris Voorbeeld BV', 300000, 'pay dec'), ...daily('2026-11-17', 17, 'Albert Heijn 1234', -2000)])) // to 3 Dec
    app.clock('2026-12-05T10:00')
    await settle()
    expect(said().length).toBe(count)
  })

  test('R-008 R-009 R-010: with complete data the close gives the month\'s own figures, and after a long silence everything owed is made up for once, in one message', async () => {
    let count = said().length
    // Sunday 6 Dec: a recap with figures again.
    app.clock('2026-12-06T18:10')
    const [recap] = await newest(count, 1)
    const p = await month()
    expect(recap.split('\n')[1]).toBe(`Free to spend until payday: ${euro(p.free.free_cents)}, about ${euro(p.free.per_day_cents)} a day for 18 days.`)
    // The December month closes on 24 Dec with its bank data complete.
    await app.importCsv(ingCsv(daily('2026-12-04', 20, 'Albert Heijn 1234', -2000))) // to 23 Dec
    count = said().length
    app.clock('2026-12-24T09:05')
    // The close and the one recap owed for the Sundays in between arrive as one message.
    const [both] = await newest(count, 1)
    const closing = both.split('\n\n')
    expect(closing).toHaveLength(2)
    const close = closing[0]
    const december = await month('2026-12')
    expect(close.split('\n')).toEqual([
      'December has ended.',
      `Spent ${euro(december.spendable_actual_cents)} of the ${euro(december.spendable_plan_cents)} planned: ${euro(december.spendable_plan_cents - december.spendable_actual_cents)} under.`,
      'Income was €3.000,00, and €0,00 went to savings.',
      'Food - Essential is €250,00 over its plan (€600,00 of €350,00).',
    ])
    expect(closing.filter(t => t.startsWith('This week\'s recap'))).toHaveLength(1)

    // The app is down for weeks: five Sunday recaps, a month close and the old-data nudge were missed.
    count = said().length
    await app.stop()
    app.clock('2027-01-25T10:00')
    await app.start()
    const [made_up] = await newest(count, 1)
    const owedParts = made_up.split('\n\n')
    expect(owedParts, 'one message for everything owed, each kind once').toHaveLength(2)
    expect(owedParts[0]).toMatch(/^January has ended, but there is no bank data for it/)
    expect(owedParts[1]).toBe('This week\'s recap: I cannot say how the month is going, because the bank data stops at 23 Dec.\nSend a new ING export here and I will catch up.')
    expect(app.value("SELECT value FROM settings WHERE key = 'nudge_stale'")).toEqual([['2027-01-25T10:00|2026-12-23']])
    // With NUDGES off the bot says nothing unasked at all.
    const quietApp = new App({ port: 18777, fakeClaude: true, env: { NUDGE_TICK_SECONDS: '1' } })
    quietApp.clock('2026-11-22T18:30')
    await quietApp.start()
    try {
      await quietApp.importCsv(ingCsv([ingRow('2026-10-25', 'Albert Heijn 1234', -2000)]))
      await settle()
      expect((await quietApp.json<any>('/chat/outbox?channel=telegram')).replies.filter((r: any) => r.kind === 'nudge')).toEqual([])
    } finally {
      await quietApp.stop()
      quietApp.destroy()
    }
  })
})

test.describe('just works for two: questions keep the quiet hours too', () => {
  test('R-010 R-012: questions from an import on the Import page at night wait for the morning; a file sent in the group is answered then and there', async () => {
    const app = new App({ port: 18778, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18779)
    app.clock('2026-11-14T22:30')
    await app.start()
    await stub.start()
    const stopBot = startBot(stub, `${app.base}/api`)
    const group = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted)
    const wait = () => new Promise(resolve => setTimeout(resolve, 4500))
    try {
      app.fake({ mode: 'reply', delay: '0', plain: JSON.stringify([unsure(0, 'Miscellaneous', ['Miscellaneous', 'Clothing'])]) })
      const done = await app.importCsv(ingCsv([ingRow('2026-11-13', 'Nachtwinkel Voorbeeld', -1200)]))
      expect(done).toMatchObject({ imported: 1, doubtful: 1 })
      await wait()
      expect(group(), 'nothing is sent unasked at night').toHaveLength(0)
      expect((await app.json<any>('/transactions/review')).description, 'it is in the review list meanwhile').toBe('Nachtwinkel Voorbeeld')
      app.clock('2026-11-15T08:59')
      await wait()
      expect(group()).toHaveLength(0)
      app.clock('2026-11-15T09:01')
      await expect.poll(() => group().length, { timeout: 20_000 }).toBe(1)
      await wait()
      expect(group().map(m => m.text)).toEqual(['Nachtwinkel Voorbeeld · 13 Nov · -€12,00\n\nWhere does it belong?'])
      expect(isQuestion(group()[0])).toBe(true)

      // Late in the evening someone sends a file in the group: that was asked for, so its summary and question come at once.
      app.clock('2026-11-15T23:00')
      await wait()
      expect(group()).toHaveLength(1)
      stub.document(DANIEL, 'late.csv', ingCsv([ingRow('2026-11-14', 'Avondwinkel Voorbeeld', -900)]))
      await expect.poll(() => group().filter(isQuestion).length, { timeout: 30_000 }).toBe(2)
      expect(group().some(m => m.text.startsWith('ING import: 1 new payment.'))).toBe(true)
      expect(group().find(m => m.text.startsWith('Avondwinkel Voorbeeld'))!.text).toBe('Avondwinkel Voorbeeld · 14 Nov · -€9,00\n\nWhere does it belong?')
      // And a press on a question at night is answered, with the next question if there is one.
      const first = group().find(m => m.text.startsWith('Nachtwinkel Voorbeeld'))!
      stub.tap(PARTNER, first, stub.button(first, 'Clothing'))
      await expect.poll(() => first.text, { timeout: 15_000 }).toBe('Nachtwinkel Voorbeeld: Clothing. 1 payment sorted.')
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })
})

test.describe('just works for two: quiet hours hold when a message can only be delivered at night', () => {
  test('R-010: a recap made in the evening while the bot was down is not sent at night, but in the morning, once', async () => {
    const app = new App({ port: 18783, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18784)
    app.clock('2026-11-14T12:00')
    await app.start()
    await stub.start()
    const group = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted)
    const wait = () => new Promise(resolve => setTimeout(resolve, 4500))
    let stopBot = () => {}
    try {
      await app.addRule('albert heijn', 'Food - Essential')
      await app.importCsv(ingCsv([ingRow('2026-11-13', 'Albert Heijn 1234', -2000)]))
      // Sunday 18:05, and no bot is running: the recap is made but cannot be shown.
      app.clock('2026-11-15T18:05')
      await expect.poll(async () => (await app.json<any>('/chat/outbox?channel=telegram')).replies.length, { timeout: 15_000 }).toBe(1)
      // The bot comes back at 22:30.
      app.clock('2026-11-15T22:30')
      expect((await app.json<any>('/chat/outbox?channel=telegram')).replies, 'held back at night').toEqual([])
      stopBot = startBot(stub, `${app.base}/api`)
      await wait()
      expect(group()).toHaveLength(0)
      app.clock('2026-11-16T08:59')
      await wait()
      expect(group()).toHaveLength(0)
      app.clock('2026-11-16T09:00')
      await expect.poll(() => group().length, { timeout: 20_000 }).toBe(1)
      expect(group()[0].text.split('\n')[0]).toBe('This week\'s recap.')
      await wait()
      expect(group(), 'once').toHaveLength(1)
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })
})

test.describe('just works for two: the waiting pile with the bot\'s own messages switched on, as the household runs it', () => {
  test('R-014: nothing is asked before Claude has judged the pile, and an answer given meanwhile is not overwritten', async () => {
    const app = new App({ port: 18785, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18786)
    app.clock('2026-11-14T12:00')
    await app.start()
    await stub.start()
    const stopBot = startBot(stub, `${app.base}/api`)
    const questions = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted && (isQuestion(m) || / sorted| Sorted/.test(m.text)))
    const find = async (name: string) => (await app.transactions()).find(t => t.description === name)
    try {
      // A pile that waited from before: guesses nobody judged sure-or-doubtful (as the earlier release left them).
      const misc = (await app.category('Miscellaneous')).id
      const rowsToAdd = [['2026-11-13', -1800, 'Pile Bakery Corner'], ['2026-11-12', -5500, 'Pile Filling Station'], ['2026-11-11', -4000, 'Pile Mw Q Voorbeeld'], ['2026-11-10', -900, 'Pile Answered Meanwhile']]
      await app.stop()
      app.sql(`INSERT INTO transactions (date, amount, description, source, category_id, confirmed, categorised_by, ai_confidence, import_hash, is_refund) VALUES ${rowsToAdd.map(([day, cents, name]) => `('${day}', ${cents}/100.0, '${name}', 'ing', ${misc}, 0, 'ai', 0.6, '${name}', 0)`).join(',')}`)
      // Claude takes eight seconds over the pile.
      app.fake({ mode: 'reply', delay: '8', plain: JSON.stringify([
        sure(0, 'Food - Not Essential'), sure(1, 'Transportation'),
        unsure(2, 'Miscellaneous', ['Miscellaneous', 'To personal accounts']), sure(3, 'Clothing'),
      ]) })
      await app.start()
      // While Claude is at it the app looks every second whether to ask: it does not.
      await new Promise(resolve => setTimeout(resolve, 4000))
      expect(questions(), 'no question before the pile is judged').toHaveLength(0)
      expect((await find('Pile Bakery Corner')).confirmed).toBe(false)
      // Someone sorts one of them in the app meanwhile.
      const meanwhile = await find('Pile Answered Meanwhile')
      await app.json(`/transactions/${meanwhile.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: (await app.category('Home & DIY')).id, confirmed: true, remember: true }) })
      // Claude is done: the sure ones count, the doubtful one is asked about with its buttons, and only that one.
      await expect.poll(async () => (await find('Pile Bakery Corner')).confirmed, { timeout: 40_000 }).toBe(true)
      expect(await find('Pile Bakery Corner')).toMatchObject({ categorised_by: 'ai', category_name: 'Food - Not Essential' })
      expect(await find('Pile Filling Station')).toMatchObject({ confirmed: true, categorised_by: 'ai', category_name: 'Transportation' })
      await expect.poll(() => questions().length, { timeout: 20_000 }).toBe(1)
      expect(questions()[0].text).toBe('Pile Mw Q Voorbeeld · 11 Nov · -€40,00\n\nWhere does it belong?')
      expect(labels(questions()[0])).toEqual(['Miscellaneous', 'To personal accounts', 'Something else'])
      // The person's answer stands: Claude's "Clothing" for it was not written over it.
      expect(await find('Pile Answered Meanwhile')).toMatchObject({ confirmed: true, categorised_by: 'manual', category_name: 'Home & DIY' })
      expect((await app.json<any[]>('/rules')).find(r => r.pattern === 'pile answered meanwhile')).toMatchObject({ category_name: 'Home & DIY' })
      await new Promise(resolve => setTimeout(resolve, 4000))
      expect(questions(), 'and nothing else is asked').toHaveLength(1)
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })
})

test.describe('just works for two: a household that used adjustments in its own way', () => {
  test('R-015 R-028: only the seeded allowance categories are removed or renamed, a switched-off adjustment takes nothing from the plan, and a card left open in the old private chat cannot be applied from the group', async () => {
    const app = new App({ port: 18787, fakeClaude: true })
    const stub = new TelegramStub(18788)
    const d = monthDates()
    const old = mkdtempSync(path.join(tmpdir(), 'hf-before-own-'))
    execFileSync('sh', ['-c', `git -C "${repo}" archive ${BEFORE} backend | tar -x -C "${old}"`])
    const dbFile = path.join((app as any).dir, 'finance.db')
    const script = `
import json, sqlite3, sys
import main
from fastapi.testclient import TestClient
from assistant import actions
from db import SessionLocal
from models import ChatMessage, ChatProposal
c = TestClient(main.app)
cats = {x["name"]: x["id"] for x in c.get("/categories").json()}
assert c.post("/rules", json={"pattern": "albert heijn", "category_id": cats["Food - Essential"], "priority": 3}).status_code == 200
# Of the two seeded allowances, the second is switched off.
seeded = c.get("/standing-adjustments").json()
assert len(seeded) == 2
assert c.patch(f"/standing-adjustments/{seeded[1]['id']}", json={"active": False}).status_code == 200
# One the household made itself, on categories it also uses for other things.
own = c.post("/standing-adjustments", json={"name": "Lunch money", "amount_cents": 10000, "income_category_id": cats["Other Income"], "expense_category_id": cats["Food - Essential"]})
assert own.status_code == 201, own.text
head = '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"'
csv = head + '\\n"${d.inMonth(1).replaceAll('-', '')}";"Albert Heijn 1234";"NL57INGB0000000000";"";"BA";"Debit";"42,00";"Payment terminal";"ah";"";""\\n'
done = c.post("/import/confirm", data={"source": "ing"}, files={"file": ("ing.csv", csv)})
assert done.status_code == 200 and done.json()["categorised_by_rule"] == 1, done.text
# A real payment in the allowance category: money moved to a personal account.
real = c.post("/transactions", json={"date": "${d.inMonth(2)}", "amount_cents": -5000, "description": "Mw Q Voorbeeld", "category_id": cats["Personal Allowance"]})
assert real.status_code == 201, real.text
assert c.get("/dashboard/pace").status_code == 200  # opening the month invents this month's payments
# A card the bot made in the old private chat, shown there and never answered.
args = {"date": "${d.inMonth(3)}", "amount_cents": -500, "description": "Old Card Coffee", "category_id": cats["Food - Not Essential"]}
preview = actions.preview("transaction.add", args)
assert preview["changes"], preview
with SessionLocal() as s:
    asked = ChatMessage(channel="telegram", role="user", kind="text", text="add 5 euro coffee", status="done")
    s.add(asked); s.flush()
    card = ChatMessage(channel="telegram", role="assistant", kind="proposal", text="", reply_to=asked.id, delivered_ids=[901])
    s.add(card); s.flush()
    s.add(ChatProposal(channel="telegram", message_id=card.id, op="transaction.add", args=args, summary="Add the coffee", preview=preview, status="pending"))
    s.commit()
out = {"categories": c.get("/categories").json(), "rules": c.get("/rules").json(), "budget": c.get("/budget", params={"month": "${d.label}"}).json()}
out["invented"] = [t for t in c.get("/transactions").json() if t["standing_adjustment_id"] is not None]
out["real"] = [t for t in c.get("/transactions").json() if t["standing_adjustment_id"] is None]
print("RESULT" + json.dumps(out))
`
    const output = execFileSync(python, ['-c', script, dbFile], {
      cwd: path.join(old, 'backend'), encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', DATABASE_URL: `sqlite:///${dbFile}` },
    })
    const before = JSON.parse(output.split('RESULT')[1])
    // The old release invented the active allowance and the household's own one; the switched-off one invented nothing.
    expect(before.invented.map((t: any) => t.amount_cents).sort((a: number, b: number) => a - b)).toEqual([-60000, -10000, 10000, 60000])
    const plannedBefore = (name: string) => before.budget.find((b: any) => b.category_name === name).planned_amount_cents
    expect(plannedBefore('Personal Allowance')).toBe(120000)

    app.clock(`${d.today}T12:00`)
    mkdirSync(path.join(app.home, 'work'), { recursive: true })
    app.fake({ mode: 'reply', delay: '0', plain: '[]' })
    app.fakeReply({ kind: 'answer', text: 'Scripted answer.' })
    await app.start()
    await stub.start()
    const stopBot = startBot(stub, `${app.base}/api`)
    try {
      // The invented payments are gone and the real ones are all there.
      const now = await app.transactions()
      expect(now.map(t => t.description).sort()).toEqual(before.real.map((t: any) => t.description).sort())
      const categories = await app.json<any[]>('/categories')
      const names = categories.map(c => c.name)
      // The household's own categories are untouched: same name, same rule, same payment.
      expect(names).toEqual(expect.arrayContaining(['Food - Essential', 'Other Income']))
      expect(categories.find(c => c.name === 'Food - Essential').id).toBe(before.categories.find((c: any) => c.name === 'Food - Essential').id)
      expect((await app.json<any[]>('/rules')).map(r => [r.pattern, r.category_name])).toEqual([['albert heijn', 'Food - Essential']])
      expect(now.find(t => t.description === 'Albert Heijn 1234')).toMatchObject({ category_name: 'Food - Essential', confirmed: true })
      // The seeded ones: the empty income one is gone; the allowance one, with a real payment in it, is now "To personal accounts".
      expect(names).not.toContain('Retained Salary')
      expect(names).not.toContain('Personal Allowance')
      expect(names.filter(n => n === 'To personal accounts')).toHaveLength(1)
      expect(now.find(t => t.description === 'Mw Q Voorbeeld')).toMatchObject({ category_name: 'To personal accounts', confirmed: true })
      // Plans lose what the invented payments took: the active allowance only, not the one that was switched off.
      expect((await app.budgetRow(d.label, 'To personal accounts')).planned_amount_cents).toBe(120000 - 60000)
      expect((await app.budgetRow(d.label, 'Food - Essential')).planned_amount_cents).toBe(plannedBefore('Food - Essential') - 10000)
      for (const other of ['Clothing', 'Transportation']) {
        expect((await app.budgetRow(d.label, other)).planned_amount_cents, other).toBe(plannedBefore(other))
      }

      // The old card is withdrawn: a first "yes" in the group applies nothing and is taken as a message.
      expect(app.value("SELECT status FROM chat_proposals WHERE channel = 'telegram'")).toEqual([['superseded']])
      const count = stub.sent.length
      stub.text(DANIEL, 'yes')
      const reply = await stub.reply_after(count, m => m.text === 'Scripted answer.')
      expect(reply.chat_id).toBe(GROUP)
      expect((await app.transactions()).some(t => t.description === 'Old Card Coffee')).toBe(false)
      expect(app.value("SELECT status FROM chat_proposals WHERE channel = 'telegram'")).toEqual([['superseded']])
      // The conversation in the group starts afresh: Claude is not given the old private chat.
      expect(app.lastCall().prompt).not.toContain('add 5 euro coffee')
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
      rmSync(old, { recursive: true, force: true })
    }
  })
})

test.describe('just works for two: when the bot could not deliver', () => {
  const stale = (to: string, days: number) => `The bank data stops at ${to}, ${days} days ago. Send a new ING export here when you can, and I will bring the month up to date.`
  const staleRecap = (to: string) => `This week's recap: I cannot say how the month is going, because the bank data stops at ${to}.\nSend a new ING export here and I will catch up.`

  test('R-010: what the app said unasked while the bot was off for two weeks arrives as one message, saying everything as of then', async () => {
    const app = new App({ port: 18789, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18790)
    app.clock('2026-11-10T12:00')
    await app.start()
    await stub.start()
    const group = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted)
    const waiting = async () => (await app.json<any>('/chat/outbox?channel=telegram')).replies.map((r: any) => r.text)
    const settle = () => new Promise(resolve => setTimeout(resolve, 4500))
    let stopBot = () => {}
    try {
      await app.addRule('salaris voorbeeld', 'Salary')
      await app.addRule('albert heijn', 'Food - Essential')
      await app.importCsv(ingCsv([ingRow('2026-10-24', 'Salaris Voorbeeld BV', 300000, 'pay'), ingRow('2026-11-03', 'Albert Heijn 1234', -2000, 'a')]))
      // No bot is running. The data turns old: one message waits, and it is kept true while it waits.
      app.clock('2026-11-11T12:00')
      await expect.poll(waiting, { timeout: 15_000 }).toEqual([stale('3 Nov', 8)])
      app.clock('2026-11-12T12:00')
      await expect.poll(waiting, { timeout: 15_000 }).toEqual([stale('3 Nov', 9)])
      // A file is imported on the Import page: the data is fresh, so the message that waited is taken back.
      await app.importCsv(ingCsv([ingRow('2026-11-09', 'Albert Heijn 1234', -2000, 'b')]))
      await expect.poll(waiting, { timeout: 15_000 }).toEqual([])
      // A week and a Sunday later: a recap is owed and the data is old again. One message waits.
      app.clock('2026-11-18T12:00')
      await expect.poll(waiting, { timeout: 15_000 }).toEqual([staleRecap('9 Nov')])
      // Another Sunday's recap, and then the month ends: still one message, now with how the month ended.
      app.clock('2026-11-22T18:05')
      await settle()
      expect(await waiting()).toEqual([staleRecap('9 Nov')])
      app.clock('2026-11-24T10:00')
      await expect.poll(async () => (await waiting())[0]?.split('\n')[0], { timeout: 15_000 }).toBe('November has ended.')
      const owed = await waiting()
      expect(owed).toHaveLength(1)
      expect(owed[0].split('\n\n')).toHaveLength(2)
      expect(owed[0].split('\n\n')[0]).toContain('The bank data only runs to 9 Nov, so the last days of the month are missing from this.')
      expect(owed[0].split('\n\n')[1]).toBe(staleRecap('9 Nov'))
      // The bot comes back the next morning: the group gets that one message, once.
      app.clock('2026-11-25T10:00')
      stopBot = startBot(stub, `${app.base}/api`)
      await expect.poll(() => group().length, { timeout: 20_000 }).toBe(1)
      expect(group()[0].text).toBe(owed[0])
      await settle()
      expect(group(), 'once, and nothing after it').toHaveLength(1)
      expect(await waiting()).toEqual([])
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })

  test('R-007 R-008: with old data the group hears about it once a week, in the recap, not twice', async () => {
    const app = new App({ port: 18791, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18792)
    app.clock('2026-11-10T12:00')
    await app.start()
    await stub.start()
    const stopBot = startBot(stub, `${app.base}/api`)
    const said = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted).map(m => m.text)
    const settle = () => new Promise(resolve => setTimeout(resolve, 4500))
    try {
      await app.addRule('albert heijn', 'Food - Essential')
      await app.importCsv(ingCsv([ingRow('2026-11-03', 'Albert Heijn 1234', -2000, 'a')]))
      app.clock('2026-11-11T12:00') // the data turns old: said once
      await expect.poll(said, { timeout: 20_000 }).toEqual([stale('3 Nov', 8)])
      app.clock('2026-11-15T18:05') // Sunday: the recap says it too
      await expect.poll(said, { timeout: 20_000 }).toEqual([stale('3 Nov', 8), staleRecap('3 Nov')])
      // Seven days after the first nudge: the recap said it three days ago, so not again now.
      for (const day of ['2026-11-18T12:00', '2026-11-20T12:00', '2026-11-22T12:00']) {
        app.clock(day)
        await settle()
        expect(said(), day).toHaveLength(2)
      }
      app.clock('2026-11-22T18:05') // the next Sunday
      await expect.poll(said, { timeout: 20_000 }).toEqual([stale('3 Nov', 8), staleRecap('3 Nov'), staleRecap('3 Nov')])
      app.clock('2026-11-23T12:00')
      await settle()
      expect(said()).toHaveLength(3)
      // A file that still leaves the data old: it says how far the data runs now.
      await app.importCsv(ingCsv([ingRow('2026-11-10', 'Albert Heijn 1234', -2000, 'b')]))
      await expect.poll(() => said().length, { timeout: 20_000 }).toBe(4)
      expect(said()[3]).toBe(stale('10 Nov', 13))
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })
})

test.describe('just works for two: payments Claude gives no answer for', () => {
  test('R-012 R-014: they are asked about too, a few at a time, and the next ones follow until none waits', async () => {
    const app = new App({ port: 18793, fakeClaude: true, env: { NUDGES: 'on', NUDGE_TICK_SECONDS: '1' } })
    const stub = new TelegramStub(18794)
    app.clock('2026-11-14T12:00')
    await app.start()
    await stub.start()
    const stopBot = startBot(stub, `${app.base}/api`)
    const group = () => stub.sent.filter(m => m.chat_id === GROUP && !m.deleted)
    const open = () => group().filter(m => isQuestion(m))
    try {
      const names = ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => `Geen Antwoord ${letter}`)
      app.fake({ mode: 'reply', delay: '0', plain: '[]' }) // Claude answers, but sorts none of them
      stub.document(PARTNER, 'export.csv', ingCsv(names.map((name, i) => ingRow('2026-11-12', name, -1000 - i))))
      await expect.poll(() => group().some(m => m.text === 'ING import: 6 new payments.\n6 need your answer, which I will ask about here.'), { timeout: 30_000 }).toBe(true)
      await expect.poll(() => open().length, { timeout: 30_000 }).toBe(3)
      const misc = (await app.category('Miscellaneous')).id
      const seen: string[] = []
      for (let round = 0; round < names.length; round++) {
        await expect.poll(() => open().length, { timeout: 30_000 }).toBeGreaterThan(0)
        expect(open().length, 'never more than three at once').toBeLessThanOrEqual(3)
        const question = open()[0]
        expect(labels(question), 'no guess to offer').toEqual(['Something else'])
        const name = question.text.split(' · ')[0]
        seen.push(name)
        const tx = (await app.transactions()).find(t => t.description === name)
        expect(tx).toMatchObject({ confirmed: false, category_id: null })
        await app.json(`/transactions/${tx.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: misc, confirmed: true }) })
        await expect.poll(() => question.text, { timeout: 20_000 }).toBe(`${name}: Sorted as Miscellaneous.`)
      }
      expect(seen.sort()).toEqual(names)
      expect((await app.json<any>('/dashboard/pace')).to_review).toBe(0)
      await new Promise(resolve => setTimeout(resolve, 4000))
      expect(open(), 'nothing is left to ask').toHaveLength(0)
    } finally {
      stopBot()
      await stub.stop()
      await app.stop()
      app.destroy()
    }
  })
})
