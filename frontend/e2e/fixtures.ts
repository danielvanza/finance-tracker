/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repo = path.resolve(here, '..', '..')
const backend = path.join(repo, 'backend')
const python = path.join(backend, '.venv', 'bin', 'python')
const uvicorn = path.join(backend, '.venv', 'bin', 'uvicorn')
export const artifacts = process.env.E2E_ARTIFACTS ?? path.join(tmpdir(), 'hf-chat-e2e')

// A stand-in for the claude CLI, used only for states that can't be triggered on demand. It runs in
// the same sandbox as the real one and is steered through files in its work folder.
const FAKE_CLAUDE = `#!/usr/bin/python3 -I
import json, os, sys, time
prompt = sys.stdin.read()
with open("/sandbox/work/last-call.json", "w") as f:
    json.dump({"argv": sys.argv, "env": sorted(os.environ), "home": os.listdir("/home"),
               "real_login_visible": os.path.exists("/home/daniel/.claude"), "prompt": prompt}, f)
with open("/sandbox/work/calls.jsonl", "a") as f:
    f.write(json.dumps({"argv": sys.argv, "prompt": prompt}) + chr(10))
def read(name, default=""):
    try:
        with open("/sandbox/work/" + name) as f: return f.read().strip()
    except OSError:
        return default
script = read("script")
mode = read("mode", "reply")
delay = float(read("delay", "0"))
if delay: time.sleep(delay)
if mode == "logged_out":
    print(json.dumps({"is_error": True, "result": "Not logged in · Please run /login"})); sys.exit(1)
if mode == "limit":
    print(json.dumps({"is_error": True, "result": "Claude usage limit reached|1793000000"})); sys.exit(1)
if mode == "garbage":
    print(json.dumps({"result": "I cannot do JSON today", "is_error": False})); sys.exit(0)
if "--mcp-config" not in sys.argv:
    print(json.dumps({"result": read("reply", '{"kind":"answer","text":"Scripted answer."}'), "is_error": False}))
    sys.exit(0)
import urllib.request
server = json.load(open("/sandbox/work/tools.json"))["mcpServers"]["finance"]
def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(server["url"], body, {**server["headers"], "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["result"]
TOOLS = {"answer": "answer", "clarify": "ask_which", "propose": "propose_change", "query": "run_query", "insight": "submit_insight", "cannot": "cannot_answer"}
def call(reply):
    if reply["kind"] == "silent":  # a turn that ends in plain text, without a reply tool
        print(json.dumps({"result": reply["text"], "is_error": False}))
        sys.exit(0)
    fields = dict(reply)
    tool = TOOLS[fields.pop("kind")]
    outcome = rpc("tools/call", {"name": tool, "arguments": fields})
    text = outcome["content"][0]["text"]
    with open("/sandbox/work/tool-calls.jsonl", "a") as f:
        f.write(json.dumps({"tool": tool, "args": fields, "isError": outcome["isError"], "text": text}) + chr(10))
    return tool, outcome["isError"], text
if not script:
    call(json.loads(read("reply", '{"kind":"answer","text":"Scripted answer."}')))
    print(json.dumps({"result": "done", "is_error": False}))
    sys.exit(0)
steps = json.loads(script)
at, refused = int(read("script-at", "0")), 0
for _ in range(40):
    step = steps[min(at, len(steps) - 1)]
    at += 1
    with open("/sandbox/work/script-at", "w") as f: f.write(str(at))
    if step.get("delay"): time.sleep(step["delay"])
    tool, failed, text = call(step["reply"])
    if not failed and tool != "run_query": break
    refused = refused + 1 if failed else 0
    if refused >= 3 or (at >= len(steps) and failed and tool != "run_query"): break
print(json.dumps({"result": "done", "is_error": False}))
`

export type AppOptions = { port: number; fakeClaude?: boolean }

export class App {
  readonly base: string
  private proc?: ChildProcess
  private readonly dir: string
  readonly home: string

  constructor(readonly options: AppOptions) {
    this.base = `http://127.0.0.1:${options.port}`
    this.dir = mkdtempSync(path.join(tmpdir(), 'hf-e2e-'))
    this.home = path.join(this.dir, 'claude')
  }

  async start() {
    // A server left behind by an earlier run would quietly answer for this one, with its own code.
    if (!this.proc && await fetch(`${this.base}/api/health`).then(() => true, () => false)) {
      throw new Error(`Port ${this.options.port} is already taken by another app`)
    }
    mkdirSync(path.join(this.home, 'work'), { recursive: true })
    const env: NodeJS.ProcessEnv = {
      PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: process.env.HOME,
      LANG: 'C.UTF-8',
      DATABASE_URL: `sqlite:///${path.join(this.dir, 'finance.db')}`,
      FRONTEND_DIST: path.join(repo, 'frontend', 'dist'),
      CLAUDE_CLI_HOME: this.home,
      CLAUDE_BIN: `${process.env.HOME}/.local/bin/claude`,
      AI_TIME_BUDGET_SECONDS: '240',
    }
    if (this.options.fakeClaude) {
      const fake = path.join(this.dir, 'fake-claude')
      writeFileSync(fake, FAKE_CLAUDE)
      chmodSync(fake, 0o755)
      const credential = path.join(this.dir, 'fake-credentials.json')
      writeFileSync(credential, '{}')
      env.CLAUDE_BIN = fake
      env.CLAUDE_CREDENTIALS = credential
    }
    this.proc = spawn(uvicorn, ['serve:app', '--host', '127.0.0.1', '--port', String(this.options.port)], {
      cwd: backend,
      env,
      stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore',
    })
    await expect.poll(async () => {
      try { return (await fetch(`${this.base}/api/health`)).status } catch { return 0 }
    }, { timeout: 30_000 }).toBe(200)
  }

  async stop() {
    this.proc?.kill('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 400))
  }

  destroy() {
    rmSync(this.dir, { recursive: true, force: true })
  }

  /** Change the throwaway database directly, to force a failure the app can't be talked into. */
  sql(statement: string) {
    execFileSync(python, ['-c', 'import sqlite3, sys; db = sqlite3.connect(sys.argv[1]); db.execute(sys.argv[2]); db.commit()', path.join(this.dir, 'finance.db'), statement])
  }

  /** Steer the fake Claude. */
  fake(files: Record<string, string>) {
    const work = path.join(this.home, 'work')
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(work, name), content)
    }
  }

  lastCall(): any {
    return JSON.parse(readFileSync(path.join(this.home, 'work', 'last-call.json'), 'utf8'))
  }

  fakeReply(reply: unknown) {
    this.fake({ mode: 'reply', delay: '0', script: '', reply: JSON.stringify(reply) })
  }

  /** Claude's replies in order, one per call; the last one repeats. Forgets earlier calls. */
  script(steps: { reply: unknown; delay?: number }[]) {
    this.fake({ mode: 'reply', delay: '0', script: JSON.stringify(steps), 'script-at': '0', 'calls.jsonl': '', 'tool-calls.jsonl': '' })
  }

  /** Every tool call the fake Claude has made since the last script(). */
  toolCalls(): { tool: string; args: any; isError: boolean; text: string }[] {
    return readFileSync(path.join(this.home, 'work', 'tool-calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  }

  /** Every result the query tool handed back, with its row labels taken off again. */
  queryResults(): any[] {
    return this.toolCalls().filter(c => c.tool === 'run_query' && !c.isError).flatMap(c => JSON.parse(c.text).results)
      .map(r => r.rows ? { ...r, columns: r.columns.slice(1), rows: r.rows.map((row: any[]) => row.slice(1)) } : r)
  }

  /** What the query tool last said about gaps in the data. */
  coverage(): any {
    const last = this.toolCalls().filter(c => c.tool === 'run_query' && !c.isError).at(-1)!
    return JSON.parse(last.text).coverage
  }

  /** Every call the fake Claude has had since the last script(). */
  calls(): { argv: string[]; prompt: string }[] {
    return readFileSync(path.join(this.home, 'work', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  }

  async json<T = any>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}/api${pathname}`, init)
    if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }

  post(pathname: string, body: unknown) {
    return this.json(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }

  transactions(): Promise<any[]> { return this.json('/transactions') }

  async category(name: string): Promise<any> {
    const all = await this.json<any[]>('/categories')
    return all.find(c => c.name === name)
  }

  async budgetRow(month: string, categoryName: string) {
    const rows = await this.json<any[]>(`/budget?month=${month}`)
    return rows.find(r => r.category_name === categoryName)
  }

  async addRule(pattern: string, categoryName: string) {
    return this.post('/rules', { pattern, category_id: (await this.category(categoryName)).id, priority: 0 })
  }

  async addManual(date: string, amountCents: number, description: string, categoryName: string, isRefund = false) {
    return this.post('/transactions', {
      date, amount_cents: amountCents, description,
      category_id: (await this.category(categoryName)).id, is_refund: isRefund,
    })
  }

  async importCsv(csv: string, source = 'ing') {
    const form = new FormData()
    form.append('source', source)
    form.append('file', new Blob([csv]), 'seed.csv')
    return this.json('/import/confirm', { method: 'POST', body: form })
  }

  /** Waits until the bot has really shown the newest card, so a typed yes can mean it. */
  async cardShown() {
    await expect.poll(async () => {
      const chat = await this.json<any>('/chat/messages?channel=telegram')
      return chat.messages.at(-1)?.card?.message_ids?.length ?? 0
    }, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0)
  }

  /** Waits until a chat's queue is empty. */
  async settled(channel: 'bubble' | 'telegram') {
    await expect.poll(async () => {
      const chat = await this.json<any>(`/chat/messages?channel=${channel}`)
      return chat.messages.filter((m: any) => m.status !== 'done').length
    }, { timeout: 220_000, intervals: [400] }).toBe(0)
  }
}

// ---- Telegram's API, as far as the bot uses it ------------------------------------------------

export const DANIEL = 424242
export const STRANGER = 777001
export const TOKEN = '999:e2e-finance-bot-token'

type StubMessage = { message_id: number; chat_id: number; text: string; reply_markup?: any; edits: string[]; deleted?: boolean }

export class TelegramStub {
  readonly base: string
  readonly sent: StubMessage[] = []
  readonly calls: string[] = []
  readonly files = new Map<string, Buffer>()
  readonly photos: { chat_id: string; body: Buffer }[] = []
  failPhotos = false
  lateButtonPresses = false
  garbledAcknowledge = false
  failSendContaining: string | null = null
  private updates: any[] = []
  private waiters: (() => void)[] = []
  private nextUpdate = 1
  private nextMessage = 1000
  private server: http.Server

  constructor(readonly port: number) {
    this.base = `http://127.0.0.1:${port}`
    this.server = http.createServer((req, res) => this.handle(req, res))
  }

  start() { return new Promise<void>(resolve => this.server.listen(this.port, '127.0.0.1', resolve)) }
  stop() { this.server.closeAllConnections(); return new Promise(resolve => this.server.close(resolve)) }

  private push(update: any) {
    this.updates.push({ update_id: this.nextUpdate++, ...update })
    this.waiters.splice(0).forEach(wake => wake())
  }

  private reply(res: http.ServerResponse, result: unknown) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, result }))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const url = req.url ?? ''
    if (url.startsWith(`/file/bot${TOKEN}/`)) {
      const name = decodeURIComponent(url.split('/').pop() ?? '')
      res.writeHead(200)
      res.end(this.files.get(name))
      return
    }
    const method = url.startsWith(`/bot${TOKEN}/`) ? url.split('/').pop()! : null
    if (!method) { res.writeHead(404); res.end(); return }
    this.calls.push(method)
    if (method === 'sendPhoto') {
      if (this.failPhotos) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, description: 'Bad Request: photo refused' }))
        return
      }
      const raw = Buffer.concat(chunks)
      this.photos.push({ chat_id: /name="chat_id"\r\n\r\n(\d+)/.exec(raw.toString('latin1'))?.[1] ?? '', body: raw })
      this.reply(res, { message_id: this.nextMessage++ })
      return
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    switch (method) {
      case 'getUpdates': {
        const offset = body.offset ?? 0
        this.updates = this.updates.filter(u => u.update_id >= offset)
        if (!this.updates.length) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 1000)
            this.waiters.push(() => { clearTimeout(timer); resolve() })
          })
        }
        this.reply(res, this.updates)
        return
      }
      case 'sendMessage': {
        if (this.failSendContaining && body.text.includes(this.failSendContaining)) {
          this.failSendContaining = null
          res.writeHead(429, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, description: 'Too Many Requests' }))
          return
        }
        const message: StubMessage = { message_id: this.nextMessage++, chat_id: body.chat_id, text: body.text, reply_markup: body.reply_markup, edits: [] }
        this.sent.push(message)
        this.reply(res, { message_id: message.message_id, chat: { id: body.chat_id, type: 'private' }, text: body.text })
        return
      }
      case 'editMessageText': {
        const message = this.sent.find(m => m.message_id === body.message_id)
        if (message) { message.edits.push(message.text); message.text = body.text; message.reply_markup = body.reply_markup }
        this.reply(res, true)
        return
      }
      case 'deleteMessage': {
        const message = this.sent.find(m => m.message_id === body.message_id)
        if (message) message.deleted = true
        this.reply(res, true)
        return
      }
      case 'answerCallbackQuery':
        if (this.garbledAcknowledge) {
          res.writeHead(502, { 'content-type': 'text/html' })
          res.end('<html>Bad Gateway</html>')
          return
        }
        if (this.lateButtonPresses) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' }))
          return
        }
        this.reply(res, true)
        return
      case 'getFile':
        this.reply(res, { file_id: body.file_id, file_path: `documents/${body.file_id}` })
        return
      default:
        this.reply(res, true)
    }
  }

  text(from: number, text: string, chatId = from, chatType = 'private') {
    this.push({ message: { message_id: this.nextMessage++, from: { id: from }, chat: { id: chatId, type: chatType }, text } })
  }

  document(from: number, name: string, content: string | Buffer) {
    const fileId = `f${this.nextMessage}`
    this.files.set(fileId, Buffer.from(content))
    this.push({ message: { message_id: this.nextMessage++, from: { id: from }, chat: { id: from, type: 'private' }, document: { file_id: fileId, file_name: name } } })
  }

  tap(from: number, message: StubMessage, data: string) {
    this.push({ callback_query: { id: `cb${this.nextUpdate}`, from: { id: from }, data, message: { message_id: message.message_id, chat: { id: from, type: 'private' }, text: message.text } } })
  }

  async reply_after(count: number, match: (m: StubMessage) => boolean = () => true) {
    let found: StubMessage | undefined
    await expect.poll(() => {
      found = this.sent.slice(count).find(match)
      return Boolean(found)
    }, { timeout: 220_000, intervals: [300] }).toBe(true)
    return found!
  }

  button(message: StubMessage, label: string) {
    const buttons = (message.reply_markup?.inline_keyboard ?? []).flat() as { text: string; callback_data: string }[]
    const button = buttons.find(b => b.text === label || b.text.includes(label))
    if (!button) throw new Error(`no button ${label} on: ${message.text}`)
    return button.callback_data
  }
}

export function startBot(stub: TelegramStub, apiUrl: string) {
  const proc = spawn(python, ['telegram_bot.py'], {
    cwd: backend,
    env: {
      PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8',
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_ALLOWED_USER_ID: String(DANIEL),
      TELEGRAM_API_BASE: stub.base,
      FINANCE_API_URL: apiUrl,
    },
    stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore',
  })
  return () => { proc.kill('SIGTERM') }
}

// ---- Dates and ING files ------------------------------------------------------------------------

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Dates around the financial month that starts on the 24th. */
export function monthDates() {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth() + (today.getDate() >= 24 ? 0 : -1), 24)
  const label = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const previousLabel = new Date(start.getFullYear(), start.getMonth(), 1)
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const add = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  return {
    today: iso(today), label: key(label), previous: key(previousLabel),
    /** The label of the financial month this many months back. */
    back: (months: number) => key(new Date(label.getFullYear(), label.getMonth() - months, 1)),
    /** A day inside the financial month this many months back. */
    backDay: (months: number, day: number) => iso(new Date(start.getFullYear(), start.getMonth() - months, start.getDate() + day)),
    inMonth: (day: number) => iso(add(start, day)),
    beforeMonth: (days: number) => iso(add(start, -days)),
  }
}

export function ingRow(date: string, description: string, cents: number, note = '') {
  const compact = date.replaceAll('-', '')
  const amount = (Math.abs(cents) / 100).toFixed(2).replace('.', ',')
  return `"${compact}";"${description}";"NL57INGB0000000000";"";"BA";"${cents < 0 ? 'Debit' : 'Credit'}";"${amount}";"Payment terminal";"${note}";"";""`
}

export const ING_HEADER = '"Date";"Name / Description";"Account";"Counterparty";"Code";"Debit/credit";"Amount (EUR)";"Transaction type";"Notifications";"Resulting balance";"Tag"'
export const ingCsv = (rows: string[]) => [ING_HEADER, ...rows].join('\n') + '\n'

// ---- Driving the bubble --------------------------------------------------------------------------

export async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Open chat' }).click()
  await expect(page.locator('dialog.chat-dialog')).toBeVisible()
}

export async function say(page: Page, text: string) {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (label: string) => `${MONTHS[Number(label.slice(5)) - 1]} ${label.slice(0, 4)}`

export const euro = (cents: number) =>
  `€${Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+$)/g, '.')},${String(Math.abs(cents) % 100).padStart(2, '0')}`

/** Nine months of synthetic bank rows, with a hole seven months back and a price change. */
export async function seedHistory(app: App, d: ReturnType<typeof monthDates>) {
  await app.addRule('albert heijn', 'Food - Essential')
  await app.addRule('salaris voorbeeld', 'Salary')
  await app.addRule('sample streaming', 'Recreation & Entertainment')
  await app.addRule('sample gym', 'Miscellaneous')
  await app.addRule('sample bakery', 'Food - Not Essential')
  await app.addRule('sample transfer', 'Internal Transfer')
  const rows: string[] = []
  for (const back of [0, 1, 2, 3, 4, 5, 6, 8]) {
    rows.push(ingRow(d.backDay(back, 0), 'Salaris Voorbeeld BV', 300000, `salary ${back}`))
    rows.push(ingRow(d.backDay(back, 1), 'Albert Heijn 1234', -(10000 + (8 - back) * 500), `ah ${back}`))
    rows.push(ingRow(d.backDay(back, 3), 'Sample Streaming', back >= 3 ? -1299 : -1599, `stream ${back}`))
    rows.push(ingRow(d.backDay(back, 5), 'Sample Gym', -3500, `gym ${back}`))
    if (back > 0) {
      rows.push(ingRow(d.backDay(back, 12), 'Sample Bakery', -450, `bakery ${back}`))
      rows.push(ingRow(d.backDay(back, 20), 'Sample Bakery', -550, `bakery two ${back}`))
      rows.push(ingRow(d.backDay(back, 27), 'Albert Heijn 1234', -2000, `ah late ${back}`))
    }
  }
  rows.push(ingRow(d.today, 'Albert Heijn 1234', -1100, 'today'))
  await app.importCsv(ingCsv(rows))
}

export const thread = (page: Page) => page.locator('.chat-thread')
export const lastPending = (page: Page): Locator => page.locator('.chat-card[data-state="pending"]').last()

/** Presses a card's button and waits for that card, not an earlier one, to reach its result. */
export async function decide(page: Page, card: Locator, button: string, state = 'applied') {
  const results = page.locator(`[data-state="${state}"]`)
  const before = await results.count()
  await card.getByRole('button', { name: button }).click()
  await expect(results).toHaveCount(before + 1)
  return results.last()
}

export async function shot(page: Page, name: string) {
  if (!existsSync(artifacts)) mkdirSync(artifacts, { recursive: true })
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) })
}
