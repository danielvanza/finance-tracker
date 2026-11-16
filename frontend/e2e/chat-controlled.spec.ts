/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, STRANGER, TelegramStub, decide, ingCsv, ingRow, lastPending, monthDates, openChat, port, repo, say, script, startBot, pendingCard,
} from './fixtures'

// Failure, access and busy states. The chat runs on bot-kit (docs/bot.md): both chats answer on botkit's scripted
// model (each message carries its own SCRIPT-* lines), the import sorter is a stand-in for the claude CLI in botkit's
// sandbox (app.fake), and the Telegram group is the real front (botkit.telegram) against a stand-in for Telegram.
const app = new App({ port: port(0), fakeClaude: true })
const stub = new TelegramStub(port(1))
const d = monthDates()
let stopBot: () => void
let page: Page

/** What a person types to get a card for this change (the script runner makes it with make_change). */
const propose = (kind: string, summary: string, args: object, says = 'Here it is.') =>
  script(['make_change', { kind, summary, args }], `SCRIPT-SAY ${says}`)
const addProposal = (description: string, cents = -1000) => async () =>
  propose('transaction.add', `Add ${description}.`, { date: d.today, amount_cents: cents, description, category_id: (await app.category('Miscellaneous')).id })
const answer = (text: string) => `SCRIPT-SAY ${text}`
const rowCount = async () => (await app.transactions()).length
const reply = () => page.locator('.bk-thread > li').last()
const bubbleError = () => page.locator('li.bk-reply.bk-error').last()
const notice = () => page.locator('.bk-notice[role="alert"]')
const imported = () => page.locator('.hf-import')

const clearChats = () => app.newChats()

/** A card still waiting for an answer: the message with the Apply button. */
const isCard = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Apply' || b.text === 'Merge')

/** Waits until the front has really shown the newest card in the group (its delivery ids are stored), so a typed yes
 *  can mean it. */
async function cardShown() {
  await expect.poll(async () => {
    const { messages } = await app.conversation('telegram')
    return messages.filter((m: any) => m.card).at(-1)?.delivered?.length ?? 0
  }, { timeout: 20_000, intervals: [200] }).toBeGreaterThan(0)
}

/** The newest card in the bubble's conversation, once its reply has landed. */
async function bubbleCard() {
  await app.settled('bubble')
  return (await app.conversation('bubble')).messages.filter((m: any) => m.card).at(-1)?.card
}

/** Sends a file the way the bubble's attach button does. */
const attach = (name: string, content: string | Buffer) =>
  page.getByTestId('bk-attach-input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })

test.describe.serial('chat in controlled conditions', () => {
  test.beforeAll(async ({ browser }) => {
    await app.start()
    // Both chats answer on botkit's scripted model; New chat keeps the choice.
    await app.useRunner('script', 'script', 'bubble')
    await app.useRunner('script', 'script', 'telegram')
    await stub.start()
    stopBot = startBot(stub, `${app.base}/api`)
    await app.addRule('sample rule shop', 'Miscellaneous')
    await app.importCsv(ingCsv([ingRow(d.inMonth(1), 'Sample Rule Shop', -1500)]))
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
    app.fake({ mode: 'reply', delay: '0', reply: '[]', plain: '' })
  })

  test('R-002: another Telegram account gets silence, changes nothing and cannot press buttons', async () => {
    await clearChats()
    const before = await rowCount()
    const count = stub.sent.length
    stub.text(STRANGER, 'How much is left this month?')
    stub.document(STRANGER, 'ing.csv', ingCsv([ingRow(d.inMonth(2), 'Stranger Row', -100)]))
    stub.text(DANIEL, 'Group message', -555, 'group')
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect(stub.sent.length).toBe(count)
    expect(await rowCount()).toBe(before)
    expect((await app.conversation('telegram')).messages).toEqual([])

    stub.text(DANIEL, await addProposal('Sample Stranger Target')())
    const card = await stub.reply_after(count, isCard)
    stub.tap(STRANGER, card, stub.button(card, 'Apply'))
    await new Promise(resolve => setTimeout(resolve, 2000))
    expect(await rowCount()).toBe(before)
    expect(isCard(card), 'the card is still waiting').toBe(true)
    stub.tap(DANIEL, card, stub.button(card, 'Not this'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Not applied')
  })

  const BAD_FILES: [string, string | Buffer][] = [
    ['random bytes', Buffer.from([0xff, 0xfe, 0x00, 0x13, 0x88, 0x90, 0xc3, 0x28])],
    ['a Revolut export', 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD,Current,2026-11-01,2026-11-01,Shop,-5.00,0,EUR,COMPLETED,10\n'],
    ['headers and no rows', ingCsv([])],
    ['a broken amount', ingCsv([`"20261101";"Shop";"NL";"";"BA";"Debit";"abc";"x";"";"";""`])],
    ['a broken date', ingCsv([`"not-a-date";"Shop";"NL";"";"BA";"Debit";"1,00";"x";"";"";""`])],
    ['an infinite amount', ingCsv([`"20261101";"Shop";"NL";"";"BA";"Debit";"Infinity";"x";"";"";""`])],
    ['a NaN amount', ingCsv([`"20261101";"Shop";"NL";"";"BA";"Debit";"NaN";"x";"";"";""`])],
    ['a short row', ingCsv([`"20261101";"Shop"`])],
    ['a row with no date', ingCsv([ingRow(d.inMonth(1), 'Sample Good Row', -100), `"";"Sample Dateless";"NL";"";"BA";"Debit";"99,00";"x";"";"";""`])],
    ['an unknown direction', ingCsv([`"20261101";"Shop";"NL";"";"BA";"Sideways";"1,00";"x";"";"";""`])],
  ]
  for (const [name, content] of BAD_FILES) {
    test(`R-006: ${name} is refused in both chats and imports nothing`, async () => {
      await clearChats()
      const before = await rowCount()
      await attach('file.csv', content)
      await expect(bubbleError()).toContainText('could not be used')
      await expect(bubbleError()).toContainText('Nothing was imported')
      const count = stub.sent.length
      stub.document(DANIEL, 'file.csv', content)
      const said = await stub.reply_after(count, m => m.text.includes('could not be used'))
      expect(said.text).toContain('Nothing was imported')
      expect(await rowCount()).toBe(before)
    })
  }

  /** Drops files on the chat panel, as a browser does when files are dragged onto it. */
  const drop = (files: [string, string][], over = true) => page.locator('dialog.chat-dialog .bk-panel-inner').evaluate((panel, [list, withOver]) => {
    const transfer = new DataTransfer()
    for (const [name, text] of list as [string, string][]) transfer.items.add(new File([text], name, { type: 'text/csv' }))
    for (const type of withOver ? ['dragover', 'drop'] : ['drop']) {
      panel.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }
  }, [files, over] as const)

  test('R-025: a file dragged onto the panel imports like an attached one', async () => {
    await clearChats()
    const before = await rowCount()
    await drop([['dragged.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop dragged', -700)])]])
    await expect(imported()).toHaveCount(1)
    await expect(imported().locator('.hf-row').first()).toHaveText('New1')
    expect(await rowCount()).toBe(before + 1)
  })

  test('R-025: several files dragged onto the panel are all imported, and a failure stops and says so', async () => {
    await clearChats()
    const before = await rowCount()
    await drop([
      ['first.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop first drop', -710)])],
      ['second.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop second drop', -720)])],
    ], false)
    await expect(imported()).toHaveCount(2)
    await expect(page.locator('.bk-me .hf-file')).toHaveText(['first.csv', 'second.csv'])
    expect(await rowCount()).toBe(before + 2)

    await page.route('**/api/chat/uploads/file', route => route.abort())
    await drop([
      ['third.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop third drop', -730)])],
      ['fourth.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop fourth drop', -740)])],
    ], false)
    await expect(notice()).toContainText('1 more was not sent')
    await page.unroute('**/api/chat/uploads/file')
    expect(await rowCount()).toBe(before + 2)
    await page.getByLabel('Message').fill('')
  })

  /** A reply that takes a while is being worked on when New chat is pressed in the panel. */
  async function clearWhileThinking(oldAnswer: string) {
    await clearChats()
    await page.reload()
    await openChat(page)
    const oldText = script('SCRIPT-SLOW 4', answer(oldAnswer))
    await say(page, oldText)
    await expect.poll(async () => (await app.conversation('bubble')).messages.at(-1)?.status, { timeout: 20_000, intervals: [100] }).toBe('running')
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await page.getByRole('button', { name: 'Start new chat' }).click()
    await expect(page.locator('.bk-thread')).not.toContainText('SCRIPT-SLOW')
  }

  test('R-028 R-029: a message sent right after Clear is answered, and the old answer never lands', async () => {
    await clearWhileThinking('Answer to the cleared question.')
    const after = answer('Answer to the new question.')
    await say(page, after)
    await expect(page.locator('.bk-reply', { hasText: 'Answer to the new question.' })).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 4500)) // past the moment the old answer would have come
    await expect(page.locator('.bk-thread')).not.toContainText('Answer to the cleared question.')
    await app.settled('bubble')
    const { messages } = await app.conversation('bubble')
    expect(messages.map((m: any) => m.text)).toEqual([after, 'Answer to the new question.'])
    expect(app.botValue("SELECT COUNT(*) FROM bot_messages WHERE text = 'Answer to the cleared question.'")).toEqual([[0]])
  })

  test('R-003 R-025 R-029: a file sent right after Clear is still imported', async () => {
    await clearWhileThinking('Another cleared answer.')
    const before = await rowCount()
    await attach('after-clear.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop after clear', -750)]))
    await expect(imported()).toBeVisible()
    await expect(imported().locator('.hf-row').first()).toHaveText('New1')
    expect(await rowCount()).toBe(before + 1)
    await new Promise(resolve => setTimeout(resolve, 3000))
    await expect(page.locator('.bk-thread')).not.toContainText('Another cleared answer.')
  })

  test('R-022: a category with no plan shows its total without a dangling "of"', async () => {
    await clearChats()
    const category = await app.post('/categories', { name: 'Sample Was Income', type: 'income' })
    await app.json(`/budget?month=${d.label}`)
    await app.json(`/categories/${category.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'wants' }),
    })
    await say(page, propose('transaction.add', 'Add the no-plan one.', { date: d.today, amount_cents: -700, description: 'Sample No Plan', category_id: category.id }))
    const card = pendingCard(page, 'Add the no-plan one.')
    const row = card.locator('.hf-effect li', { hasText: 'this month' })
    await expect(row).toContainText('€7,00')
    expect((await row.innerText()).trim().endsWith('of')).toBe(false)
    await card.getByRole('button', { name: 'Not this' }).click()
  })

  test('R-008: "not this" and silence change nothing, and a double tap applies once', async () => {
    await clearChats()
    const before = await rowCount()
    await say(page, await addProposal('Sample Double Tap')())
    const card = lastPending(page)
    await expect(card).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(await rowCount()).toBe(before)

    const { id, version } = await bubbleCard()
    await Promise.all(Array.from({ length: 6 }, () => app.post(`/chat/cards/${id}/apply`, { version })))
    expect((await app.transactions()).filter(t => t.description === 'Sample Double Tap')).toHaveLength(1)

    await say(page, await addProposal('Sample Browser Double Tap')())
    const second = pendingCard(page, 'Sample Browser Double Tap')
    await expect(second).toBeVisible()
    await second.getByRole('button', { name: 'Apply' }).dblclick()
    await expect(page.locator('[data-state="applied"]', { hasText: 'Sample Browser Double Tap' })).toBeVisible()
    expect((await app.transactions()).filter(t => t.description === 'Sample Browser Double Tap')).toHaveLength(1)
  })

  test('R-015: a logged-out or exhausted Claude is said plainly in both chats and imports nothing', async () => {
    // The chat's runner failing (botkit's reasons, named for the runner) and the sorter failing during an import.
    const csv = ingCsv([ingRow(d.inMonth(2), 'Sample Needs Claude', -900)])
    for (const [kind, mode, phrase] of [['logged_out', 'logged_out', 'logged out'], ['rate_limited', 'limit', 'usage limit']] as const) {
      await clearChats()
      app.fake({ mode })
      const before = await app.transactions()
      await say(page, `SCRIPT-FAIL ${kind}`)
      await expect(bubbleError()).toContainText(phrase)
      await expect(bubbleError()).toContainText('Nothing changed')
      const count = stub.sent.length
      stub.text(DANIEL, `SCRIPT-FAIL ${kind}`)
      const said = await stub.reply_after(count, m => m.text.includes(phrase))
      expect(said.text).toContain('Nothing changed')

      await attach('f.csv', csv)
      await expect(page.locator('li.bk-reply.bk-error', { hasText: 'Nothing was imported' })).toContainText(phrase)
      expect(await app.transactions()).toEqual(before)
    }
  })

  test('R-015: a change the app rejects says why and changes nothing', async () => {
    await clearChats()
    const ing = (await app.transactions()).find(t => t.source === 'ing')
    const before = await rowCount()
    // The app's reason goes back to the agent (finance-agent R-007); with no words of its own, the script's reply
    // is what its tools answered.
    await say(page, script(['make_change', { kind: 'transaction.delete', summary: 'Delete it.', args: { id: ing.id } }]))
    await expect(reply()).toContainText('make_change (error)')
    await expect(reply()).toContainText('No card was shown, because the app would not take this')
    await expect(reply()).toContainText('Only manual transactions can be deleted')
    await expect(pendingCard(page, 'Delete it.')).toHaveCount(0)
    expect(app.botValue("SELECT COUNT(*) FROM bot_cards WHERE summary = 'Delete it.'")).toEqual([[0]])
    expect(await rowCount()).toBe(before)
  })

  test('R-018: the model cannot merge, cannot act by claiming, and has no files, tools or key', async () => {
    await clearChats()
    const before = await app.transactions()
    await say(page, script(['make_change', { kind: 'merge', summary: 'Merge.', args: { manual_id: 1, bank_id: 2 } }]))
    await expect(reply()).toContainText('make_change (error)')
    await expect(pendingCard(page, 'Merge.')).toHaveCount(0)
    expect(app.botValue("SELECT COUNT(*) FROM bot_cards WHERE kind = 'merge'")).toEqual([[0]])
    await say(page, answer('Done! I have deleted every rule and applied everything.'))
    await expect(reply()).toContainText('Done!')
    expect(await app.transactions()).toEqual(before)
    expect((await app.json<any[]>('/rules')).length).toBeGreaterThan(0)

    // The claude CLI runs in botkit's sandbox (the chat's "Claude Code" runner and the sorter alike): no built-in
    // tools, no slash commands, no outside MCP servers, an empty /home without the real login, no API keys.
    const fake = path.join(path.dirname(app.home), 'fake-claude')
    const original = readFileSync(fake, 'utf8')
    writeFileSync(fake, original.replace('prompt = sys.stdin.read()\n', [
      'prompt = sys.stdin.read()',
      'json.dump({"env": sorted(os.environ), "home": os.listdir("/home"), "real_login_visible": os.path.exists("/home/daniel/.claude")}, open("/sandbox/home/fake/seen.json", "w"))',
      '',
    ].join('\n')))
    try {
      await attach('sorted.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Sorted By Claude', -910)]))
      await expect(imported().last()).toBeVisible()
      await app.settled('bubble')
      const call = app.sorterCalls().at(-1)!
      const tools = call.argv.indexOf('--tools')
      expect(tools).toBeGreaterThan(-1)
      expect(call.argv[tools + 1]).toBe('')
      expect(call.argv).toContain('--strict-mcp-config')
      expect(call.argv).toContain('--disable-slash-commands')
      const seen = JSON.parse(readFileSync(path.join(app.home, 'home', 'fake', 'seen.json'), 'utf8'))
      expect(seen.real_login_visible).toBe(false)
      expect(seen.home).toEqual([])
      expect(seen.env).not.toContain('ANTHROPIC_API_KEY')
      expect(seen.env).not.toContain('OPENAI_API_KEY')
    } finally {
      writeFileSync(fake, original)
    }
  })

  test('R-016 R-017: both chats send Claude exactly the same thing', async () => {
    await clearChats()
    // SCRIPT-ECHO answers with the whole prompt the model was given.
    await say(page, 'SCRIPT-ECHO')
    await app.settled('bubble')
    const bubble = (await app.conversation('bubble')).messages.at(-1).text
    const count = stub.sent.length
    stub.text(DANIEL, 'SCRIPT-ECHO')
    await stub.reply_after(count, m => m.text.includes('<new_message>'))
    await app.settled('telegram')
    const telegram = (await app.conversation('telegram')).messages.at(-1).text
    expect(telegram).toContain('<conversation>')
    expect(telegram).toBe(bubble)
    const bot = readFileSync(path.join(repo, 'backend', 'telegram_bot.py'), 'utf8')
    expect(bot).not.toMatch(/import (anthropic|openai)|hermes/i)
  })

  test('R-023 R-015: apply fails when the row is gone, says nothing changed, offers Try again', async () => {
    await clearChats()
    const category = await app.post('/categories', { name: 'Sample Doomed', type: 'wants' })
    await say(page, propose('transaction.add', 'Add Sample Failed Row.', { date: d.today, amount_cents: -500, description: 'Sample Failed Row', category_id: category.id }))
    const card = pendingCard(page, 'Add Sample Failed Row.')
    await expect(card).toBeVisible()
    await app.json(`/categories/${category.id}`, { method: 'DELETE' })
    await card.getByRole('button', { name: 'Apply' }).click()
    const failed = page.locator('[data-state="failed"]').last()
    await expect(failed).toContainText("didn't go through, and nothing changed")
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect((await app.transactions()).some(t => t.description === 'Sample Failed Row')).toBe(false)
  })

  test('R-022: a change that moves the budget indirectly still shows its effect', async () => {
    await clearChats()
    await say(page, propose('setting.set', 'Move the start.', { key: 'financial_month_start_day', value: '1' }))
    await expect.poll(async () => (await bubbleCard())?.summary, { timeout: 20_000 }).toBe('Move the start.')
    expect((await bubbleCard()).data.effect.length).toBeGreaterThan(0)

    // A start-day change that relabels the current month: the card must equal what the app then shows.
    const setStart = (value: string) => app.json('/settings/financial_month_start_day', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }),
    })
    await setStart('5')
    await say(page, propose('setting.set', 'Start on the first.', { key: 'financial_month_start_day', value: '1' }))
    await expect.poll(async () => (await bubbleCard())?.summary, { timeout: 20_000 }).toBe('Start on the first.')
    const relabel = await bubbleCard()
    await app.post(`/chat/cards/${relabel.id}/apply`, { version: relabel.version })
    const current = (await app.json('/dashboard/pace')).current_month
    for (const row of relabel.data.effect.filter((e: any) => e.when === 'this month')) {
      expect((await app.budgetRow(current, row.category)).actual_amount_cents).toBe(row.after_cents)
    }
    await setStart('24')

    const movable = await app.post('/categories', { name: 'Sample Movable', type: 'wants' })
    const planned = (await app.json<any[]>(`/budget?month=${d.label}`)).find(r => r.category_id === movable.id)
    await app.json(`/budget/${planned.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: 7000 }) })
    await say(page, propose('category.update', 'Make it a need.', { id: movable.id, type: 'needs' }))
    await expect.poll(async () => (await bubbleCard())?.summary, { timeout: 20_000 }).toBe('Make it a need.')
    const kinds = (await bubbleCard()).data.effect.map((e: any) => e.category)
    expect(kinds).toEqual(expect.arrayContaining(['Needs', 'Wants']))
    await app.json(`/categories/${movable.id}`, { method: 'DELETE' })
  })

  test('R-022: a card that went stale is shown again, not applied', async () => {
    await clearChats()
    const row = (await app.transactions()).find(t => t.description === 'Sample Double Tap')
    await say(page, propose('transaction.update', 'Move it.', { id: row.id, category_id: (await app.category('Clothing')).id }))
    const card = pendingCard(page, 'Move it.')
    await expect(card).toBeVisible()
    await app.json(`/transactions/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: (await app.category('Home & DIY')).id }),
    })
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card.locator('.bk-stale')).toContainText('nothing was applied')
    expect((await app.transactions()).find(t => t.id === row.id).category_name).toBe('Home & DIY')
  })

  test('R-029 R-025: a message sent while another reply is being worked on waits visibly, then answers', async () => {
    // One reply is worked on at a time, across both chats: a message behind it waits, and says so.
    await clearChats()
    await say(page, script('SCRIPT-SLOW 6', answer('First answered.')))
    await expect.poll(async () => (await app.conversation('bubble')).messages.at(-1)?.status, { timeout: 15_000 }).toBe('running')
    await say(page, answer('Answered after waiting.'))
    await expect(page.getByTestId('bk-pending').last()).toContainText('Waiting for another reply to finish')
    const count = stub.sent.length
    stub.text(DANIEL, answer('Telegram answered after waiting.'))
    const waitingNote = await stub.reply_after(count, m => m.text.startsWith('Waiting for Claude'))
    expect(waitingNote.text).toBe('Waiting for Claude. Your message is saved and will be answered as soon as it is free.')
    await expect(page.locator('.bk-reply', { hasText: 'Answered after waiting.' })).toBeVisible({ timeout: 30_000 })
    await stub.reply_after(count, m => m.text === 'Telegram answered after waiting.')
  })

  test('R-029: a waiting message survives a restart of the app', async () => {
    await clearChats()
    await say(page, script('SCRIPT-SLOW 8', answer('Remembered after the restart.')))
    await expect(page.getByTestId('bk-pending')).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    await app.stop()
    await app.start()
    await expect(page.locator('.bk-reply', { hasText: 'Remembered after the restart.' })).toBeVisible({ timeout: 60_000 })
  })

  test('R-015 R-023: with the app down both chats say so; Try again works when it is back', async () => {
    await clearChats()
    const before = await rowCount()
    await say(page, await addProposal('Sample Outage Row')())
    const card = pendingCard(page, 'Sample Outage Row')
    await expect(card).toBeVisible()

    const count = stub.sent.length
    stub.text(DANIEL, await addProposal('Sample Outage Telegram')())
    const telegramCard = await stub.reply_after(count, isCard)
    await app.settled('telegram')

    await app.stop()

    // The bubble keeps the card waiting and says the app could not be reached, so the person can press again.
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card.locator('.bk-failed')).toContainText("can't be reached")
    await expect(card.locator('.bk-failed')).not.toContainText('nothing changed')

    await say(page, 'are you there?')
    await expect(notice()).toContainText("can't be reached")
    await expect(page.getByLabel('Message')).toHaveValue('are you there?')

    const beforeDown = stub.sent.length
    stub.text(DANIEL, 'are you there?')
    const down = await stub.reply_after(beforeDown, m => m.text.includes("can't be reached"))
    expect(down.text).toContain('nothing changed')
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Apply'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain("didn't go through")
    expect(stub.button(telegramCard, 'Try again')).toBeTruthy()

    await app.start()
    await page.getByLabel('Message').fill('')
    expect(await rowCount()).toBe(before)
    await expect(await decide(page, card, 'Apply')).toContainText('Done.')
    expect((await app.transactions()).filter(t => t.description === 'Sample Outage Row')).toHaveLength(1)
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Try again'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain('Applied.')
    expect((await app.transactions()).filter(t => t.description === 'Sample Outage Telegram')).toHaveLength(1)
  })

  test('R-008 R-012 R-023: after a failed "Not this" the card still waits; pressing it again says No and changes nothing', async () => {
    await clearChats()
    const before = await rowCount()
    const applied: string[] = []
    page.on('request', request => { if (request.url().endsWith('/apply')) applied.push(request.url()) })
    await say(page, await addProposal('Sample Declined Row')())
    const card = pendingCard(page, 'Sample Declined Row')
    await expect(card).toBeVisible()

    await page.route('**/chat/cards/*/reject', route => route.abort())
    await card.getByRole('button', { name: 'Not this' }).click()
    await expect(card.locator('.bk-failed')).toContainText("can't be reached", { timeout: 20_000 })
    await expect(card.getByRole('button', { name: 'Not this' })).toBeEnabled()
    await page.unroute('**/chat/cards/*/reject')

    await expect(await decide(page, card, 'Not this', 'rejected')).toContainText('Not applied. Nothing changed.')
    expect(applied).toEqual([])
    expect(await rowCount()).toBe(before)
    expect((await app.transactions()).some(t => t.description === 'Sample Declined Row')).toBe(false)

    // The No arrived but the answer got lost: the screen follows what really happened.
    await say(page, await addProposal('Sample Lost Decline')())
    const lost = pendingCard(page, 'Sample Lost Decline')
    await expect(lost).toBeVisible()
    const declined = await page.locator('[data-state="rejected"]').count()
    await page.route('**/chat/cards/*/reject', async route => { await route.fetch(); await route.abort() })
    await lost.getByRole('button', { name: 'Not this' }).click()
    await expect(page.locator('[data-state="rejected"]')).toHaveCount(declined + 1, { timeout: 20_000 })
    await page.unroute('**/chat/cards/*/reject')
    expect(applied).toEqual([])
    expect(await rowCount()).toBe(before)
  })

  test('R-008 R-015 R-023: with the app down a failed "Not this" is unconfirmed in both chats and retried as a No', async () => {
    await clearChats()
    const before = await rowCount()
    await say(page, await addProposal('Sample Outage Decline')())
    const card = pendingCard(page, 'Sample Outage Decline')
    await expect(card).toBeVisible()
    const count = stub.sent.length
    stub.text(DANIEL, await addProposal('Sample Outage Decline Telegram')())
    const telegramCard = await stub.reply_after(count, isCard)
    await app.settled('telegram')

    await app.stop()
    await card.getByRole('button', { name: 'Not this' }).click()
    await expect(card.locator('.bk-failed')).toContainText("can't be reached")
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Not this'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain("didn't go through")
    expect(stub.button(telegramCard, 'Try again')).toMatch(/^r:/)

    await app.start()
    await expect(await decide(page, card, 'Not this', 'rejected')).toContainText('Not applied.')
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Try again'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain('Not applied')
    expect(await rowCount()).toBe(before)
  })

  test('R-012 R-023: after a failed "Keep both" pressing it again keeps both rows and does not merge', async () => {
    await clearChats()
    const entry = await app.addManual(d.inMonth(5), -3100, 'Sample Keep Both Manual', 'Miscellaneous')
    await attach('keep.csv', ingCsv([ingRow(d.inMonth(5), 'Sample Rule Shop keep both', -3100)]))
    const merge = page.locator('.bk-card', { hasText: 'Looks like the same payment' })
    await expect(merge).toBeVisible()
    await expect(merge.getByRole('button', { name: 'Merge' })).toBeVisible()
    const applied: string[] = []
    page.on('request', request => { if (request.url().endsWith('/apply')) applied.push(request.url()) })

    await page.route('**/chat/cards/*/reject', route => route.abort())
    await merge.getByRole('button', { name: 'Keep both' }).click()
    await expect(merge.locator('.bk-failed')).toContainText("can't be reached", { timeout: 20_000 })
    await page.unroute('**/chat/cards/*/reject')

    await expect(await decide(page, merge, 'Keep both', 'rejected')).toContainText('Kept both. Nothing changed.')
    expect(applied).toEqual([])
    const all = await app.transactions()
    expect(all.some(t => t.id === entry.id)).toBe(true)
    expect(all.some(t => t.description === 'Sample Rule Shop keep both')).toBe(true)
  })

  test('R-005 R-015: when the double-entry check fails after an import, the chat says the import is saved', async () => {
    await clearChats()
    await app.addManual(d.inMonth(6), -3300, 'Sample Failed Check Manual', 'Miscellaneous')
    app.sql("CREATE TRIGGER block_merge BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
    try {
      await attach('check.csv', ingCsv([ingRow(d.inMonth(6), 'Sample Rule Shop failed check', -3300)]))
      await expect(imported()).toBeVisible()
      const said = page.locator('li.bk-reply.bk-error', { hasText: 'The import is saved.' })
      await expect(said).toBeVisible()
      await expect(said).not.toContainText('nothing changed')
      await expect(page.locator('.bk-thread')).not.toContainText('so nothing changed')
      await expect(page.locator('.bk-card', { hasText: 'Looks like the same payment' })).toHaveCount(0)
      expect((await app.transactions()).some(t => t.description === 'Sample Rule Shop failed check')).toBe(true)
    } finally {
      app.sql('DROP TRIGGER block_merge')
    }
  })

  test('R-015: a blank reply from Claude is never shown and does not hold up later replies', async () => {
    await clearChats()
    await say(page, 'SCRIPT-SAY    ')
    await expect(page.locator('li.bk-reply.bk-error', { hasText: "answer came back empty" })).toBeVisible()

    const count = stub.sent.length
    stub.text(DANIEL, 'SCRIPT-SAY    ')
    await stub.reply_after(count, m => m.text.includes('answer came back empty'))
    expect(stub.sent.slice(count).some(m => m.text.trim() === '')).toBe(false)

    const next = stub.sent.length
    stub.text(DANIEL, answer('Back to normal.'))
    await stub.reply_after(next, m => m.text === 'Back to normal.')
  })

  /** What a tap on a choice sends (choice_text), with the model's next steps after it: the script runner stands in
   *  for the model that would read the choice and carry on. */
  const chose = (tx: any, ...lines: (string | [string, object])[]) =>
    [`That one: ${tx.description}, (id ${tx.id})`, script(...lines)].join('\n')

  test('R-009: a manually entered refund asks which purchase when two look the same', async () => {
    await clearChats()
    await app.addRule('sample hand twin', 'Miscellaneous')
    await app.importCsv(ingCsv([
      ingRow(d.inMonth(1), 'Sample Hand Twin', -800, 'a'), ingRow(d.inMonth(2), 'Sample Hand Twin', -800, 'b'),
    ]))
    const before = await rowCount()
    const twins = (await app.transactions()).filter(t => t.description === 'Sample Hand Twin')
    const handRefund = (purchase: any) => ['make_change', { kind: 'refund.add', summary: 'Add the hand refund.', args: { purchase_id: purchase.id, amount_cents: 800, date: d.today, description: 'Sample Hand Refund' } }] as [string, object]
    await say(page, script(handRefund(twins[0]), ['show_choices', { ids: twins.map(t => t.id) }], answer('Which purchase was it?')))
    const options = page.locator('.bk-options').last()
    await expect(options.getByRole('button')).toHaveCount(2)
    await expect(pendingCard(page, 'Add the hand refund.')).toHaveCount(0)
    expect(app.botValue("SELECT COUNT(*) FROM bot_cards WHERE summary = 'Add the hand refund.'")).toEqual([[0]])
    expect(await rowCount()).toBe(before)

    // Once a purchase is chosen, the card can be made.
    await say(page, chose(twins[1], handRefund(twins[1]), answer('Here is the card.')))
    await expect(pendingCard(page, 'Add the hand refund.')).toBeVisible()
    expect(await rowCount()).toBe(before)

    // A tap on a choice is saved as the person's words, naming the payment and its id.
    await say(page, script(['show_choices', { ids: twins.map(t => t.id) }], answer('Which one?')))
    await app.settled('bubble')
    const choice = page.locator('.bk-reply', { hasText: 'Which one?' }).last().locator('.bk-option').first()
    await expect(choice).toBeEnabled()
    await choice.click()
    await app.settled('bubble')
    const picked = (await app.conversation('bubble')).messages.filter((m: any) => m.role === 'user').at(-1)
    expect(picked.payload.choice_id).toBe(twins[0].id)
    expect(picked.text).toMatch(new RegExp(`^That one: Sample Hand Twin, .+ \\(id ${twins[0].id}\\)$`))
  })

  async function staleMove(description: string, channel: 'bubble' | 'telegram') {
    const row = await app.addManual(d.inMonth(3), -1234, description, 'Miscellaneous')
    const text = propose('transaction.update', `Move ${description}.`, { id: row.id, category_id: (await app.category('Clothing')).id })
    const count = stub.sent.length
    if (channel === 'bubble') await say(page, text)
    else stub.text(DANIEL, text)
    const telegramCard = channel === 'telegram' ? await stub.card_after(count, description) : null
    if (channel === 'bubble') await expect(pendingCard(page, `Move ${description}.`)).toBeVisible()
    await app.settled(channel)
    const moved = async () => (await app.transactions()).find(t => t.id === row.id).category_name
    const makeStale = async () => app.json(`/transactions/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: (await app.category('Home & DIY')).id }),
    })
    return { row, telegramCard, moved, makeStale }
  }

  test('R-008: a double tap on an out-of-date Telegram card never applies the version nobody saw', async () => {
    await clearChats()
    const { telegramCard, moved, makeStale } = await staleMove('Double Stale Sample', 'telegram')
    await makeStale()
    const oldApply = stub.button(telegramCard!, 'Apply')
    stub.tap(DANIEL, telegramCard!, oldApply)
    stub.tap(DANIEL, telegramCard!, oldApply)
    await expect.poll(() => telegramCard!.text, { timeout: 15_000 }).toContain('nothing was applied')
    await new Promise(resolve => setTimeout(resolve, 1500))
    stub.tap(DANIEL, telegramCard!, oldApply)
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(await moved()).toBe('Home & DIY')
    expect(telegramCard!.text).toContain('Home & DIY → Clothing')

    const newApply = stub.button(telegramCard!, 'Apply')
    expect(newApply).not.toBe(oldApply)
    stub.tap(DANIEL, telegramCard!, newApply)
    await expect.poll(() => telegramCard!.text, { timeout: 15_000 }).toContain('Applied.')
    expect(await moved()).toBe('Clothing')
  })

  test('R-008: a tap from a second screen on a replaced card changes nothing, in the app too', async () => {
    await clearChats()
    const { moved, makeStale } = await staleMove('Bubble Stale Sample', 'bubble')
    const seen = await bubbleCard()
    await makeStale()
    const refreshed = (await app.post(`/chat/cards/${seen.id}/apply`, { version: seen.version })).card
    expect(refreshed.status).toBe('open')
    expect(refreshed.version).not.toBe(seen.version)
    const again = (await app.post(`/chat/cards/${seen.id}/apply`, { version: seen.version })).card
    expect(again.status).toBe('open')
    expect(again.version).toBe(refreshed.version)
    expect(await moved()).toBe('Home & DIY')

    const card = pendingCard(page, 'Move Bubble Stale Sample.')
    await expect(card).toContainText('Home & DIY', { timeout: 20_000 })
    await expect(await decide(page, card, 'Apply')).toContainText('Home & DIY → Clothing')
    expect(await moved()).toBe('Clothing')
  })

  test('R-008: a typed yes cannot apply a card that was just replaced', async () => {
    await clearChats()
    const { moved, makeStale, telegramCard } = await staleMove('Typed Stale Sample', 'telegram')
    await cardShown()
    await makeStale()
    stub.text(DANIEL, 'yes')
    await expect.poll(() => telegramCard!.text, { timeout: 15_000 }).toContain('nothing was applied')
    // A second yes cannot say which version it meant, so it goes to the model as words (here: the script, which
    // runs nothing) and the card stays open.
    const count = stub.sent.length
    stub.text(DANIEL, 'yes')
    await stub.reply_after(count, m => m.text === 'The script ran no tools.')
    expect(await moved()).toBe('Home & DIY')
    expect((await app.conversation('telegram')).messages.filter((m: any) => m.card).at(-1).card.status).toBe('open')
  })

  test('R-023: the result says what was really saved, even if Claude described it wrongly', async () => {
    await clearChats()
    const clothing = await app.category('Clothing')
    await app.json(`/budget?month=${d.label}`)
    const proposal = (cents: number) => propose('budget.set', 'Lower the Clothing budget to €50,00.', { category_id: clothing.id, month: d.label, planned_amount_cents: cents }, 'Lowered as asked.')
    await say(page, proposal(99900))
    const card = pendingCard(page, 'Lower the Clothing')
    await expect(card).toBeVisible()
    const done = await decide(page, card, 'Apply')
    await expect(done).toContainText('Done.')
    await expect(done).toContainText('Budget for Clothing')
    await expect(done).toContainText('→ €999,00')
    await expect(done).not.toContainText('Lower the Clothing')

    const count = stub.sent.length
    stub.text(DANIEL, proposal(88800))
    const telegramCard = await stub.card_after(count, 'Budget for Clothing')
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Apply'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain('Applied.')
    expect(telegramCard.text).toContain('→ €888,00')
    expect(telegramCard.text).not.toContain('Lower the Clothing')
  })

  test('R-022: a split shows which part is a refund, and a change to only that mark is a change', async () => {
    await clearChats()
    await app.addRule('sample split refund', 'Salary')
    await app.importCsv(ingCsv([ingRow(d.inMonth(1), 'Sample Split Refund', 5000)]))
    const row = (await app.transactions()).find(t => t.description === 'Sample Split Refund')
    const clothing = await app.category('Clothing')
    const salary = await app.category('Salary')
    const split = (refund: boolean) => propose('transaction.split', refund ? 'Split it.' : 'Stop the refund part.',
      { id: row.id, parts: [{ category_id: clothing.id, amount_cents: 2000, is_refund: refund }, { category_id: salary.id, amount_cents: 3000 }] })
    await say(page, split(true))
    const card = pendingCard(page, 'Split it.')
    await expect(card).toContainText('Clothing €20,00 (refund) + Salary €30,00')
    const done = await decide(page, card, 'Apply')
    await expect(done).toContainText('Clothing €20,00 (refund) + Salary €30,00')

    await say(page, split(false))
    const flagOnly = pendingCard(page, 'Stop the refund part.')
    await expect(flagOnly).toContainText('(refund)')
    await expect(flagOnly).toContainText('Clothing €20,00 + Salary €30,00')
    await flagOnly.getByRole('button', { name: 'Not this' }).click()
  })

  test('R-003: a file sent on Telegram still imports when the "Reading" notice fails', async () => {
    await clearChats()
    const before = await rowCount()
    stub.failSendContaining = 'Reading your file'
    const count = stub.sent.length
    stub.document(DANIEL, 'notice.csv', ingCsv([ingRow(d.inMonth(4), 'Sample Rule Shop notice failed', -910)]))
    const summary = await stub.reply_after(count, m => m.text.startsWith('ING import'))
    expect(summary.text).toContain('1 new payment')
    expect(await rowCount()).toBe(before + 1)
    expect(stub.failSendContaining).toBeNull()
    expect(stub.sent.slice(count).some(m => m.text.includes('Reading your file'))).toBe(false)
  })

  test('R-008: a button press still counts when Telegram garbles its reply to the bot', async () => {
    await clearChats()
    const count = stub.sent.length
    stub.text(DANIEL, await addProposal('Sample Garbled Press')())
    const card = await stub.card_after(count, 'Sample Garbled Press')
    stub.garbledAcknowledge = true
    try {
      stub.tap(DANIEL, card, stub.button(card, 'Apply'))
      await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Applied.')
    } finally {
      stub.garbledAcknowledge = false
    }
    expect((await app.transactions()).filter(t => t.description === 'Sample Garbled Press')).toHaveLength(1)
  })

  test('R-009: a "which one?" chain ends once each side has been chosen', async () => {
    await clearChats()
    await app.addRule('sample twin', 'Miscellaneous')
    await app.importCsv(ingCsv([
      ingRow(d.inMonth(1), 'Sample Twin Shop', -500, 'a'), ingRow(d.inMonth(2), 'Sample Twin Shop', -500, 'b'),
      ingRow(d.inMonth(3), 'Sample Twin Shop', 500, 'c'), ingRow(d.inMonth(4), 'Sample Twin Shop', 500, 'd'),
    ]))
    const twins = (await app.transactions()).filter(t => t.description === 'Sample Twin Shop')
    const refund = twins.find(t => t.amount_cents === 500)
    const purchase = twins.find(t => t.amount_cents === -500)
    const book = ['make_change', { kind: 'refund.book', summary: 'Book the twin.', args: { refund_id: refund.id, purchase_id: purchase.id } }] as [string, object]
    const ask = (sign: number) => [['show_choices', { ids: twins.filter(t => Math.sign(t.amount_cents) === sign).map(t => t.id) }] as [string, object], answer('Which one?')]
    const optionsBefore = await page.locator('.bk-options').count()
    // Neither side has been said: the card is refused and the refunds are offered.
    await say(page, script(book, ...ask(1)))
    await expect(page.locator('.bk-options')).toHaveCount(optionsBefore + 1)
    await expect(page.locator('.bk-options').last().getByRole('button')).toHaveCount(2)
    // The refund is chosen; the purchase still is not, so the card is refused again and the purchases are offered.
    await say(page, chose(refund, book, ...ask(-1)))
    await expect(page.locator('.bk-options')).toHaveCount(optionsBefore + 2)
    await expect(pendingCard(page, 'Book the twin.')).toHaveCount(0)
    // Both chosen: the card is made.
    await say(page, chose(purchase, book, answer('Here it is.')))
    await expect(pendingCard(page, 'Book the twin.')).toBeVisible()
  })

  test('R-015 R-023: when an answer is lost on the way back, the screen follows what really happened', async () => {
    await clearChats()
    await say(page, await addProposal('Sample Lost Response')())
    const card = pendingCard(page, 'Sample Lost Response')
    await expect(card).toBeVisible()
    await page.route('**/chat/cards/*/apply', async route => { await route.fetch(); await route.abort() })
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('[data-state="applied"]', { hasText: 'Sample Lost Response' })).toBeVisible({ timeout: 20_000 })
    await page.unroute('**/chat/cards/*/apply')
    expect((await app.transactions()).filter(t => t.description === 'Sample Lost Response')).toHaveLength(1)

    await page.route('**/api/chat/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fetch()
      await route.abort()
    })
    await say(page, answer('Heard the lost message.'))
    await expect(page.locator('.bk-reply', { hasText: 'Heard the lost message.' })).toBeVisible()
    await page.unroute('**/api/chat/messages')
    await expect(notice()).toHaveCount(0)
    await expect(page.getByLabel('Message')).toHaveValue('')
  })

  test('R-015: the bot says what it knows when the app answers with an error', async () => {
    let status = 500
    const fakeApp = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/chat/outbox')) { res.end(JSON.stringify({ replies: [], edits: [], in_flight: [] })); return }
      res.statusCode = status
      res.end(JSON.stringify({ detail: 'no' }))
    })
    await new Promise<void>(resolve => fakeApp.listen(port(2), '127.0.0.1', resolve))
    const other = new TelegramStub(port(3))
    await other.start()
    const stop = startBot(other, `http://127.0.0.1:${port(2)}`)
    other.text(DANIEL, 'hello')
    const unsure = await other.reply_after(0, m => m.text.includes("can't tell"))
    expect(unsure.text).not.toContain('nothing changed')
    status = 404
    const count = other.sent.length
    other.text(DANIEL, 'hello again')
    const refused = await other.reply_after(count, m => m.text.includes("didn't accept"))
    expect(refused.text).toContain('nothing changed')
    stop()
    await other.stop()
    fakeApp.closeAllConnections()
    await new Promise(resolve => fakeApp.close(resolve))
  })

  test('R-015: many requests filling a new month at once all succeed', async () => {
    for (const year of [2031, 2032, 2033, 2034]) {
      const replies = await Promise.all(Array.from({ length: 12 }, () => fetch(`${app.base}/api/budget?month=${year}-03`)))
      expect(replies.map(r => r.status).filter(s => s !== 200)).toEqual([])
      const rows = await app.json<any[]>(`/budget?month=${year}-03`)
      expect(new Set(rows.map(r => r.category_id)).size).toBe(rows.length)
    }
  })

  test('R-008: a button press that reaches the bot late is still applied, once', async () => {
    await clearChats()
    const count = stub.sent.length
    stub.text(DANIEL, await addProposal('Sample Late Press')())
    const card = await stub.reply_after(count, isCard)
    await cardShown()
    stub.lateButtonPresses = true
    stub.tap(DANIEL, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Applied.')
    stub.lateButtonPresses = false
    expect((await app.transactions()).filter(t => t.description === 'Sample Late Press')).toHaveLength(1)
  })

  test('R-008: a typed yes cannot apply a card the reader has not been shown', async () => {
    await clearChats()
    const before = await rowCount()
    stopBot()
    await app.post('/chat/messages', { channel: 'telegram', text: await addProposal('Sample Unseen Card')() })
    await app.settled('telegram')
    await app.post('/chat/messages', { channel: 'telegram', text: 'ok' })
    await app.settled('telegram')
    expect(await rowCount()).toBe(before)

    // In the bubble too: a yes from a screen that has not got the card yet does nothing.
    await app.post('/chat/new', { channel: 'bubble' })
    await app.post('/chat/messages', { channel: 'bubble', text: await addProposal('Sample Unseen Bubble')() })
    await app.settled('bubble')
    await app.post('/chat/messages', { channel: 'bubble', text: 'yes', seen_message_id: 0 })
    await app.settled('bubble')
    expect(await rowCount()).toBe(before)
    stopBot = startBot(stub, `${app.base}/api`)
    await app.post('/chat/new', { channel: 'telegram' })
  })

  test('R-015 R-029: replies reach Telegram after the app restarts mid-message', async () => {
    await clearChats()
    const count = stub.sent.length
    stub.text(DANIEL, script('SCRIPT-SLOW 8', answer('Telegram heard after the restart.')))
    await expect.poll(() => app.conversation('telegram').then(c => c.messages.length), { timeout: 15_000 }).toBeGreaterThan(0)
    await new Promise(resolve => setTimeout(resolve, 2500))
    await app.stop()
    const told = await stub.reply_after(count, m => m.text.includes('stopped while'))
    expect(told.text).not.toContain('nothing changed')
    await app.start()
    await stub.reply_after(count, m => m.text === 'Telegram heard after the restart.')
  })

  test('R-005 R-015: an import interrupted by a restart still ends in its summary', async () => {
    await clearChats()
    app.fake({ delay: '20', mode: 'reply' })
    const count = stub.sent.length
    stub.document(DANIEL, 'restart.csv', ingCsv([ingRow(d.inMonth(4), 'Sample Restart Row', -321)]))
    await stub.reply_after(count, m => m.text.startsWith('Reading your file'))
    await new Promise(resolve => setTimeout(resolve, 2500))
    await app.stop()
    app.fake({ delay: '0' })
    await app.start()
    const summary = await stub.reply_after(count, m => m.text.startsWith('ING import'))
    expect(summary.text).toContain('1 new payment')
    expect((await app.transactions()).filter(t => t.description === 'Sample Restart Row')).toHaveLength(1)
  })

  test('R-023: a card with a very long row is still one Telegram message, before and after Apply', async () => {
    // A card no longer spills over several messages (just-works-for-two R-003): its lines are cut to fit.
    await clearChats()
    const count = stub.sent.length
    stub.text(DANIEL, propose('transaction.add', 'Add the long one.', {
      date: d.today, amount_cents: -1000, description: `Sample Long ${'x'.repeat(4200)}`, category_id: (await app.category('Miscellaneous')).id,
    }))
    const card = await stub.reply_after(count, isCard)
    // Questions about earlier imports may arrive in between; they are not part of this card.
    const isQuestion = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Something else') || / sorted| Sorted/.test(m.text)
    const parts = () => stub.sent.slice(count).filter(m => !m.deleted && !isQuestion(m) && !/^(Working on it|Stopping)/.test(m.text))
    expect(parts()).toHaveLength(1)
    expect(card.text.length).toBeLessThanOrEqual(4096)
    expect(card.text).toContain('Add: Sample Long xxxx')
    await cardShown()
    stub.tap(DANIEL, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Applied.')
    expect(parts()).toHaveLength(1)
    expect((await app.transactions()).filter(t => t.description.startsWith('Sample Long ') && t.description.length > 4200)).toHaveLength(1)
  })

  test('R-024: no sign-in step and no wording that assumes who is looking', async () => {
    await clearChats()
    await page.reload()
    await openChat(page)
    await expect(page.locator('.bk-empty')).toBeVisible()
    const copy = await page.locator('dialog.chat-dialog').innerText()
    expect(copy).not.toMatch(/daniel|partner|sign in|log in/i)
    const prompt = readFileSync(path.join(repo, 'backend', 'assistant', 'prompts.py'), 'utf8')
    expect(prompt).not.toMatch(/daniel/i)
    await say(page, answer('Scripted answer.'))
    await expect(reply()).toContainText('Scripted')
  })
})
