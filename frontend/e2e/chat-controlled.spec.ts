/* eslint-disable @typescript-eslint/no-explicit-any -- API responses in the test harness */
import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import {
  App, DANIEL, STRANGER, TelegramStub, decide, ingCsv, ingRow, lastPending, monthDates, openChat, repo, say, startBot, pendingCard,
} from './fixtures'

// Failure, access and busy states, with a scripted stand-in for the claude CLI in the same sandbox.
const app = new App({ port: 18711, fakeClaude: true })
const stub = new TelegramStub(18712)
const d = monthDates()
let stopBot: () => void
let page: Page

const addProposal = (description: string, cents = -1000) => async () => ({
  kind: 'propose', summary: `Add ${description}.`, op: 'transaction.add',
  args: { date: d.today, amount_cents: cents, description, category_id: (await app.category('Miscellaneous')).id },
})
const answer = (text: string) => ({ kind: 'answer', text })
const rowCount = async () => (await app.transactions()).length

const clearChats = () => app.newChats()

/** A card still waiting for an answer: the message with the Apply button. */
const isCard = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Apply' || b.text === 'Merge')

test.describe.serial('chat in controlled conditions', () => {
  test.beforeAll(async ({ browser }) => {
    await app.start()
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
    app.fake({ mode: 'reply', delay: '0' })
    app.fakeReply(answer('Scripted answer.'))
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
    expect((await app.json('/chat/messages?channel=telegram')).messages).toEqual([])

    app.fakeReply(await addProposal('Sample Stranger Target')())
    stub.text(DANIEL, 'add it')
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
      await page.getByTestId('chat-file').setInputFiles({ name: 'file.csv', mimeType: 'text/csv', buffer: Buffer.from(content) })
      await expect(page.locator('.chat-error').last()).toContainText('could not be used')
      await expect(page.locator('.chat-error').last()).toContainText('Nothing was imported')
      const count = stub.sent.length
      stub.document(DANIEL, 'file.csv', content)
      const reply = await stub.reply_after(count, m => m.text.includes('could not be used'))
      expect(reply.text).toContain('Nothing was imported')
      expect(await rowCount()).toBe(before)
    })
  }

  test('R-025: a file dragged onto the panel imports like an attached one', async () => {
    await clearChats()
    const before = await rowCount()
    const csv = ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop dragged', -700)])
    await page.locator('dialog.chat-dialog').evaluate((dialog, text) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([text], 'dragged.csv', { type: 'text/csv' }))
      for (const type of ['dragover', 'drop']) {
        dialog.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
    }, csv)
    const card = page.locator('.chat-card', { hasText: 'ING import' })
    await expect(card).toBeVisible()
    await expect(card.locator('.chat-row').first()).toHaveText('New1')
    expect(await rowCount()).toBe(before + 1)
  })

  test('R-025: several files dragged onto the panel are all imported, and a failure stops and says so', async () => {
    await clearChats()
    const before = await rowCount()
    const drop = (files: [string, string][]) => page.locator('dialog.chat-dialog').evaluate((dialog, list) => {
      const transfer = new DataTransfer()
      for (const [name, text] of list) transfer.items.add(new File([text], name, { type: 'text/csv' }))
      dialog.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }, files)
    await drop([
      ['first.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop first drop', -710)])],
      ['second.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop second drop', -720)])],
    ])
    await expect(page.locator('.chat-card', { hasText: 'ING import' })).toHaveCount(2)
    await expect(page.locator('.chat-me.chat-file')).toHaveText(['first.csv', 'second.csv'])
    expect(await rowCount()).toBe(before + 2)

    await page.route('**/api/chat/files', route => route.abort())
    await drop([
      ['third.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop third drop', -730)])],
      ['fourth.csv', ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop fourth drop', -740)])],
    ])
    await expect(page.locator('.chat-error[role="alert"]')).toContainText('1 more was not sent')
    await page.unroute('**/api/chat/files')
    expect(await rowCount()).toBe(before + 2)
    await page.getByLabel('Message').fill('')
  })

  async function clearWhileThinking(oldText: string, oldAnswer: string, after: { text: string; answer: string } | null) {
    await clearChats()
    app.fake({ 'script-at': '0', script: JSON.stringify([
      { delay: 4, reply: answer(oldAnswer) },
      ...(after ? [{ reply: answer(after.answer) }] : []),
    ]) })
    await say(page, oldText)
    await expect.poll(() => { // Claude has really been asked, so its answer is on the way
      try { return app.lastCall().prompt.includes(oldText) } catch { return false }
    }, { timeout: 20_000, intervals: [100] }).toBe(true)
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await page.getByRole('button', { name: 'Start new chat' }).click()
    await expect(page.locator('.chat-thread')).not.toContainText(oldText)
  }

  test('R-028 R-029: a message sent right after Clear is answered, and the old answer never lands', async () => {
    try {
      await clearWhileThinking('the question before clear', 'Answer to the cleared question.', { text: 'the question after clear', answer: 'Answer to the new question.' })
      await say(page, 'the question after clear')
      await expect(page.locator('.chat-reply', { hasText: 'Answer to the new question.' })).toBeVisible()
      await expect(page.locator('.chat-thread')).not.toContainText('Answer to the cleared question.')
      expect(app.lastCall().prompt).toContain('the question after clear')
      await app.settled('bubble')
      const { messages } = await app.json('/chat/messages?channel=bubble')
      expect(messages.map((m: any) => m.text)).toEqual(['the question after clear', 'Answer to the new question.'])
    } finally {
      app.fake({ script: '', 'script-at': '0' })
    }
  })

  test('R-003 R-025 R-029: a file sent right after Clear is still imported', async () => {
    try {
      await clearWhileThinking('another question before clear', 'Another cleared answer.', null)
      const before = await rowCount()
      await page.getByTestId('chat-file').setInputFiles({
        name: 'after-clear.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow(d.inMonth(2), 'Sample Rule Shop after clear', -750)])),
      })
      const card = page.locator('.chat-card', { hasText: 'ING import' })
      await expect(card).toBeVisible()
      await expect(card.locator('.chat-row').first()).toHaveText('New1')
      expect(await rowCount()).toBe(before + 1)
      await expect(page.locator('.chat-thread')).not.toContainText('Another cleared answer.')
    } finally {
      app.fake({ script: '', 'script-at': '0' })
    }
  })

  test('R-022: a category with no plan shows its total without a dangling "of"', async () => {
    await clearChats()
    const category = await app.post('/categories', { name: 'Sample Was Income', type: 'income' })
    await app.json(`/budget?month=${d.label}`)
    await app.json(`/categories/${category.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'wants' }),
    })
    app.fakeReply({ kind: 'propose', summary: 'Add the no-plan one.', op: 'transaction.add', args: { date: d.today, amount_cents: -700, description: 'Sample No Plan', category_id: category.id } })
    await say(page, 'add the no-plan one')
    const card = pendingCard(page, 'Add the no-plan one.')
    const row = card.locator('.chat-effect li', { hasText: 'this month' })
    await expect(row).toContainText('€7,00')
    expect((await row.innerText()).trim().endsWith('of')).toBe(false)
    await card.getByRole('button', { name: 'Not this' }).click()
  })

  test('R-008: "not this" and silence change nothing, and a double tap applies once', async () => {
    await clearChats()
    const before = await rowCount()
    app.fakeReply(await addProposal('Sample Double Tap')())
    await say(page, 'add a thing')
    const card = lastPending(page)
    await expect(card).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(await rowCount()).toBe(before)

    const { messages } = await app.json('/chat/messages?channel=bubble')
    const { id, version } = messages.at(-1).card
    await Promise.all(Array.from({ length: 6 }, () => app.post(`/chat/proposals/${id}/apply`, { version })))
    expect((await app.transactions()).filter(t => t.description === 'Sample Double Tap')).toHaveLength(1)

    app.fakeReply(await addProposal('Sample Browser Double Tap')())
    await say(page, 'add another')
    const second = lastPending(page)
    await expect(second).toBeVisible()
    await second.getByRole('button', { name: 'Apply' }).dblclick()
    await expect(page.locator('[data-state="applied"]', { hasText: 'Sample Browser Double Tap' })).toBeVisible()
    expect((await app.transactions()).filter(t => t.description === 'Sample Browser Double Tap')).toHaveLength(1)
  })

  test('R-015: a logged-out or exhausted Claude is said plainly in both chats and imports nothing', async () => {
    const csv = ingCsv([ingRow(d.inMonth(2), 'Sample Needs Claude', -900)])
    for (const [mode, phrase] of [['logged_out', 'logged out'], ['limit', 'usage limit']] as const) {
      await clearChats()
      app.fake({ mode })
      const before = await app.transactions()
      await say(page, 'How are we doing?')
      const bubbleError = page.locator('.chat-error').last()
      await expect(bubbleError).toContainText(phrase)
      await expect(bubbleError).toContainText('Nothing changed')
      const count = stub.sent.length
      stub.text(DANIEL, 'Add 5 euro at the shop')
      const reply = await stub.reply_after(count, m => m.text.includes(phrase))
      expect(reply.text).toContain('Nothing changed')

      await page.getByTestId('chat-file').setInputFiles({ name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await expect(page.locator('.chat-error').last()).toContainText('Nothing was imported')
      expect(await app.transactions()).toEqual(before)
    }
  })

  test('R-015: a change the app rejects says why and changes nothing', async () => {
    await clearChats()
    const imported = (await app.transactions()).find(t => t.source === 'ing')
    const before = await rowCount()
    // The app's reason goes back to the agent (finance-agent R-007), which tells the person in its own words.
    app.fakeReply({ kind: 'propose', summary: 'Delete it.', op: 'transaction.delete', args: { id: imported.id }, text: "I can't delete that one: only manual entries can be deleted. Nothing changed." })
    await say(page, 'delete that bank row')
    await expect(page.locator('.chat-reply').last()).toContainText('only manual entries can be deleted')
    const [refused] = app.toolCalls()
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('Only manual transactions can be deleted')
    await expect(pendingCard(page, 'Delete it.')).toHaveCount(0)
    expect(await rowCount()).toBe(before)
  })

  test('R-018: the model cannot merge, cannot act by claiming, and has no files, tools or key', async () => {
    await clearChats()
    const before = await app.transactions()
    app.fakeReply({ kind: 'propose', summary: 'Merge.', op: 'merge', args: { manual_id: 1, bank_id: 2 }, text: 'I could not do that.' })
    await say(page, 'merge them')
    await expect(page.locator('.chat-reply').last()).toContainText('I could not do that.')
    expect(app.toolCalls()[0].text).toContain("there is no change called 'merge'")
    await expect(pendingCard(page, 'Merge.')).toHaveCount(0)
    app.fakeReply(answer('Done! I have deleted every rule and applied everything.'))
    await say(page, 'do it')
    await expect(page.locator('.chat-reply').last()).toContainText('Done!')
    expect(await app.transactions()).toEqual(before)
    expect((await app.json<any[]>('/rules')).length).toBeGreaterThan(0)

    const call = app.lastCall()
    const tools = call.argv.indexOf('--tools')
    expect(tools).toBeGreaterThan(-1)
    expect(call.argv[tools + 1]).toBe('')
    expect(call.argv).toContain('--strict-mcp-config')
    expect(call.argv).toContain('--disable-slash-commands')
    expect(call.real_login_visible).toBe(false)
    expect(call.home).toEqual([])
    expect(call.env).not.toContain('ANTHROPIC_API_KEY')
    expect(call.env).not.toContain('OPENAI_API_KEY')
  })

  test('R-016 R-017: both chats send Claude exactly the same thing', async () => {
    await clearChats()
    await say(page, 'Same words')
    await expect(page.locator('.chat-reply').last()).toContainText('Scripted')
    await app.settled('bubble')
    const bubble = app.lastCall()
    const count = stub.sent.length
    stub.text(DANIEL, 'Same words')
    await stub.reply_after(count, m => m.text === 'Scripted answer.')
    const telegram = app.lastCall()
    expect(telegram.prompt).toBe(bubble.prompt)
    expect(telegram.argv).toEqual(bubble.argv)
    const bot = readFileSync(path.join(repo, 'backend', 'telegram_bot.py'), 'utf8')
    expect(bot).not.toMatch(/import (anthropic|openai)|hermes/i)
  })

  test('R-023 R-015: apply fails when the row is gone, says nothing changed, offers Try again', async () => {
    await clearChats()
    const category = await app.post('/categories', { name: 'Sample Doomed', type: 'wants' })
    app.fakeReply({
      kind: 'propose', summary: 'Add Sample Failed Row.', op: 'transaction.add',
      args: { date: d.today, amount_cents: -500, description: 'Sample Failed Row', category_id: category.id },
    })
    await say(page, 'add it')
    const card = lastPending(page)
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
    const pendingCard = async () => {
      await app.settled('bubble')
      return (await app.json('/chat/messages?channel=bubble')).messages.at(-1).card
    }

    app.fakeReply({ kind: 'propose', summary: 'Move the start.', op: 'setting.set', args: { key: 'financial_month_start_day', value: '1' } })
    await say(page, 'start day')
    await expect.poll(async () => (await pendingCard())?.summary, { timeout: 20_000 }).toBe('Move the start.')
    expect((await pendingCard()).effect.length).toBeGreaterThan(0)

    // A start-day change that relabels the current month: the card must equal what the app then shows.
    const setStart = (value: string) => app.json('/settings/financial_month_start_day', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }),
    })
    await setStart('5')
    app.fakeReply({ kind: 'propose', summary: 'Start on the first.', op: 'setting.set', args: { key: 'financial_month_start_day', value: '1' } })
    await say(page, 'start on the first')
    await expect.poll(async () => (await pendingCard())?.summary, { timeout: 20_000 }).toBe('Start on the first.')
    const relabel = await pendingCard()
    await app.post(`/chat/proposals/${relabel.id}/apply`, { version: relabel.version })
    const current = (await app.json('/dashboard/pace')).current_month
    for (const row of relabel.effect.filter((e: any) => e.when === 'this month')) {
      expect((await app.budgetRow(current, row.category)).actual_amount_cents).toBe(row.after_cents)
    }
    await setStart('24')

    const movable = await app.post('/categories', { name: 'Sample Movable', type: 'wants' })
    const planned = (await app.json<any[]>(`/budget?month=${d.label}`)).find(r => r.category_id === movable.id)
    await app.json(`/budget/${planned.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_amount_cents: 7000 }) })
    app.fakeReply({ kind: 'propose', summary: 'Make it a need.', op: 'category.update', args: { id: movable.id, type: 'needs' } })
    await say(page, 'type')
    await expect.poll(async () => (await pendingCard())?.summary, { timeout: 20_000 }).toBe('Make it a need.')
    const kinds = (await pendingCard()).effect.map((e: any) => e.category)
    expect(kinds).toEqual(expect.arrayContaining(['Needs', 'Wants']))
    await app.json(`/categories/${movable.id}`, { method: 'DELETE' })
  })

  test('R-022: a card that went stale is shown again, not applied', async () => {
    await clearChats()
    const row = (await app.transactions()).find(t => t.description === 'Sample Double Tap')
    app.fakeReply({
      kind: 'propose', summary: 'Move it.', op: 'transaction.update',
      args: { id: row.id, category_id: (await app.category('Clothing')).id },
    })
    await say(page, 'move it')
    const card = pendingCard(page, 'Move it.')
    await expect(card).toBeVisible()
    await app.json(`/transactions/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category_id: (await app.category('Home & DIY')).id }),
    })
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card.locator('.chat-note')).toContainText('nothing was applied')
    expect((await app.transactions()).find(t => t.id === row.id).category_name).toBe('Home & DIY')
  })

  test('R-029 R-025: a message sent while Claude is busy waits visibly, then answers', async () => {
    await clearChats()
    app.fake({ mode: 'reply', delay: '5' })
    app.fakeReply(answer('Answered after waiting.'))
    app.fake({ delay: '5' })
    // The Import page's own Claude run is holding the line.
    const form = new FormData()
    form.append('source', 'ing')
    form.append('file', new Blob([ingCsv([ingRow(d.inMonth(3), 'Sample Busy Import', -300)])]), 'b.csv')
    const importing = fetch(`${app.base}/api/import/confirm`, { method: 'POST', body: form })
    await expect.poll(() => app.json('/chat/messages?channel=bubble').then(c => c.claude_busy), { timeout: 15_000 }).toBe(true)

    await say(page, 'First question')
    await expect(page.getByTestId('chat-pending')).toContainText('Waiting for Claude')
    const count = stub.sent.length
    stub.text(DANIEL, 'Second question')
    const waitingNote = await stub.reply_after(count, m => m.text.startsWith('Waiting for Claude'))
    expect(waitingNote).toBeTruthy()
    await importing
    await expect(page.locator('.chat-reply', { hasText: 'Answered after waiting.' })).toBeVisible()
    await stub.reply_after(count, m => m.text === 'Answered after waiting.')
  })

  test('R-029: a waiting message survives a restart of the app', async () => {
    await clearChats()
    app.fake({ delay: '20' })
    await say(page, 'Will you remember this?')
    await expect(page.getByTestId('chat-pending')).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 1500))
    await app.stop()
    app.fake({ delay: '0' })
    app.fakeReply(answer('Remembered after the restart.'))
    await app.start()
    await expect(page.locator('.chat-reply', { hasText: 'Remembered after the restart.' })).toBeVisible()
  })

  test('R-015 R-023: with the app down both chats say so; Try again works when it is back', async () => {
    await clearChats()
    const before = await rowCount()
    app.fakeReply(await addProposal('Sample Outage Row')())
    await say(page, 'add for the outage')
    const card = lastPending(page)
    await expect(card).toBeVisible()

    const count = stub.sent.length
    app.fakeReply(await addProposal('Sample Outage Telegram')())
    stub.text(DANIEL, 'add on telegram')
    const telegramCard = await stub.reply_after(count, isCard)

    await app.stop()

    await card.getByRole('button', { name: 'Apply' }).click()
    const failed = page.locator('[data-state="failed"]').last()
    await expect(failed).toContainText("can't be reached")
    await expect(failed).toContainText("Couldn't confirm")
    await expect(failed).not.toContainText('nothing changed')

    await say(page, 'are you there?')
    await expect(page.locator('.chat-error[role="alert"]')).toContainText("can't be reached")
    await expect(page.getByLabel('Message')).toHaveValue('are you there?')

    const beforeDown = stub.sent.length
    stub.text(DANIEL, 'are you there?')
    const down = await stub.reply_after(beforeDown, m => m.text.includes("can't be reached"))
    expect(down.text).toContain('nothing changed')
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Apply'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain("didn't go through")
    expect(stub.button(telegramCard, 'Try again')).toBeTruthy()

    await app.start()
    expect(await rowCount()).toBe(before)
    await expect(failed).toContainText("didn't go through, and nothing changed", { timeout: 20_000 })
    await expect(await decide(page, failed, 'Try again')).toContainText('Done.')
    expect((await app.transactions()).filter(t => t.description === 'Sample Outage Row')).toHaveLength(1)
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Try again'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain('Applied.')
    expect((await app.transactions()).filter(t => t.description === 'Sample Outage Telegram')).toHaveLength(1)
  })

  test('R-008 R-012 R-023: Try again after a failed "Not this" repeats the No and changes nothing', async () => {
    await clearChats()
    const before = await rowCount()
    const applied: string[] = []
    page.on('request', request => { if (request.url().endsWith('/apply')) applied.push(request.url()) })
    app.fakeReply(await addProposal('Sample Declined Row')())
    await say(page, 'add the declined one')
    const card = pendingCard(page, 'Sample Declined Row')
    await expect(card).toBeVisible()

    await page.route('**/chat/proposals/*/reject', route => route.abort())
    await card.getByRole('button', { name: 'Not this' }).click()
    const failed = page.locator('[data-state="failed"]').last()
    await expect(failed).toContainText('"Not this" didn\'t go through, so this is still waiting for an answer.', { timeout: 20_000 })
    await expect(failed).toContainText("Try again won't make the change.")
    await failed.getByRole('button', { name: 'Try again' }).click()
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeEnabled({ timeout: 20_000 })
    await expect(failed).toContainText('"Not this" didn\'t go through', { timeout: 20_000 })
    await page.unroute('**/chat/proposals/*/reject')

    await expect(await decide(page, failed, 'Try again', 'rejected')).toContainText('Not applied. Nothing changed.')
    expect(applied).toEqual([])
    expect(await rowCount()).toBe(before)
    expect((await app.transactions()).some(t => t.description === 'Sample Declined Row')).toBe(false)

    // The No arrived but the answer got lost: the screen follows what really happened.
    app.fakeReply(await addProposal('Sample Lost Decline')())
    await say(page, 'add the lost decline')
    const lost = pendingCard(page, 'Sample Lost Decline')
    await expect(lost).toBeVisible()
    const declined = await page.locator('[data-state="rejected"]').count()
    await page.route('**/chat/proposals/*/reject', async route => { await route.fetch(); await route.abort() })
    await lost.getByRole('button', { name: 'Not this' }).click()
    await expect(page.locator('[data-state="rejected"]')).toHaveCount(declined + 1, { timeout: 20_000 })
    await page.unroute('**/chat/proposals/*/reject')
    expect(applied).toEqual([])
    expect(await rowCount()).toBe(before)
  })

  test('R-008 R-015 R-023: with the app down a failed "Not this" is unconfirmed in both chats and retried as a No', async () => {
    await clearChats()
    const before = await rowCount()
    app.fakeReply(await addProposal('Sample Outage Decline')())
    await say(page, 'add for the outage decline')
    const card = pendingCard(page, 'Sample Outage Decline')
    await expect(card).toBeVisible()
    const count = stub.sent.length
    app.fakeReply(await addProposal('Sample Outage Decline Telegram')())
    stub.text(DANIEL, 'add on telegram')
    const telegramCard = await stub.reply_after(count, isCard)

    await app.stop()
    await card.getByRole('button', { name: 'Not this' }).click()
    const failed = page.locator('[data-state="failed"]').last()
    await expect(failed).toContainText('Couldn\'t confirm "Not this" went through.')
    await expect(failed).toContainText("can't be reached")
    await expect(failed).toContainText("Try again won't make the change.")
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Not this'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain("didn't go through")

    await app.start()
    await expect(failed).toContainText('"Not this" didn\'t go through', { timeout: 20_000 })
    await expect(await decide(page, failed, 'Try again', 'rejected')).toContainText('Not applied.')
    stub.tap(DANIEL, telegramCard, stub.button(telegramCard, 'Try again'))
    await expect.poll(() => telegramCard.text, { timeout: 15_000 }).toContain('Not applied')
    expect(await rowCount()).toBe(before)
  })

  test('R-012 R-023: Try again after a failed "Keep both" keeps both rows and does not merge', async () => {
    await clearChats()
    const entry = await app.addManual(d.inMonth(5), -3100, 'Sample Keep Both Manual', 'Miscellaneous')
    await page.getByTestId('chat-file').setInputFiles({
      name: 'keep.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow(d.inMonth(5), 'Sample Rule Shop keep both', -3100)])),
    })
    const merge = page.locator('.chat-card', { hasText: 'Looks like the same payment' })
    await expect(merge).toBeVisible()
    const applied: string[] = []
    page.on('request', request => { if (request.url().endsWith('/apply')) applied.push(request.url()) })

    await page.route('**/chat/proposals/*/reject', route => route.abort())
    await merge.getByRole('button', { name: 'Keep both' }).click()
    const failed = page.locator('[data-state="failed"]').last()
    await expect(failed).toContainText('"Keep both" didn\'t go through, so this is still waiting for an answer.', { timeout: 20_000 })
    await page.unroute('**/chat/proposals/*/reject')

    await expect(await decide(page, failed, 'Try again', 'rejected')).toContainText('Kept both. Nothing changed.')
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
      await page.getByTestId('chat-file').setInputFiles({
        name: 'check.csv', mimeType: 'text/csv', buffer: Buffer.from(ingCsv([ingRow(d.inMonth(6), 'Sample Rule Shop failed check', -3300)])),
      })
      await expect(page.locator('.chat-card', { hasText: 'ING import' })).toBeVisible()
      const notice = page.locator('.chat-error', { hasText: 'The import is saved.' })
      await expect(notice).toBeVisible()
      await expect(notice).not.toContainText('nothing changed')
      await expect(page.locator('.chat-thread')).not.toContainText('so nothing changed')
      await expect(page.locator('.chat-card', { hasText: 'Looks like the same payment' })).toHaveCount(0)
      expect((await app.transactions()).some(t => t.description === 'Sample Rule Shop failed check')).toBe(true)
    } finally {
      app.sql('DROP TRIGGER block_merge')
    }
  })

  test('R-015: a blank reply from Claude is never shown and does not hold up later replies', async () => {
    await clearChats()
    app.fakeReply(answer('   '))
    await say(page, 'blank please')
    await expect(page.locator('.chat-error', { hasText: "Claude's answer came back empty" })).toBeVisible()

    const count = stub.sent.length
    stub.text(DANIEL, 'blank please')
    await stub.reply_after(count, m => m.text.includes("Claude's answer came back empty"))
    expect(stub.sent.slice(count).some(m => m.text.trim() === '')).toBe(false)

    app.fakeReply(answer('Back to normal.'))
    const next = stub.sent.length
    stub.text(DANIEL, 'and now?')
    await stub.reply_after(next, m => m.text === 'Back to normal.')
  })

  test('R-009: a manually entered refund asks which purchase when two look the same', async () => {
    await clearChats()
    await app.addRule('sample hand twin', 'Miscellaneous')
    await app.importCsv(ingCsv([
      ingRow(d.inMonth(1), 'Sample Hand Twin', -800, 'a'), ingRow(d.inMonth(2), 'Sample Hand Twin', -800, 'b'),
    ]))
    const before = await rowCount()
    const purchase = (await app.transactions()).find(t => t.description === 'Sample Hand Twin')
    const twins = (await app.transactions()).filter(t => t.description === 'Sample Hand Twin')
    const handRefund = { kind: 'propose', summary: 'Add the hand refund.', op: 'refund.add', args: { purchase_id: purchase.id, amount_cents: 800, date: d.today, description: 'Sample Hand Refund' } }
    app.script([
      { reply: handRefund },
      { reply: { kind: 'choices', transaction_ids: twins.map(t => t.id) } },
      { reply: answer('Which purchase was it?') },
      { reply: handRefund },
      { reply: answer('Here is the card.') },
    ])
    await say(page, 'that hand twin shop gave me 8 euro back')
    const options = page.locator('.chat-options').last()
    await expect(options.getByRole('button')).toHaveCount(2)
    await expect(pendingCard(page, 'Add the hand refund.')).toHaveCount(0)
    await options.getByRole('button').first().click()
    await expect(pendingCard(page, 'Add the hand refund.')).toBeVisible()
    expect(await rowCount()).toBe(before)
  })

  async function staleMove(description: string, channel: 'bubble' | 'telegram') {
    const row = await app.addManual(d.inMonth(3), -1234, description, 'Miscellaneous')
    app.fakeReply({
      kind: 'propose', summary: `Move ${description}.`, op: 'transaction.update',
      args: { id: row.id, category_id: (await app.category('Clothing')).id },
    })
    const count = stub.sent.length
    if (channel === 'bubble') await say(page, `move ${description}`)
    else stub.text(DANIEL, `move ${description}`)
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
    const seen = (await app.json('/chat/messages?channel=bubble')).messages.at(-1).card
    await makeStale()
    const refreshed = await app.post(`/chat/proposals/${seen.id}/apply`, { version: seen.version })
    expect(refreshed.status).toBe('pending')
    expect(refreshed.version).not.toBe(seen.version)
    const again = await app.post(`/chat/proposals/${seen.id}/apply`, { version: seen.version })
    expect(again.status).toBe('pending')
    expect(await moved()).toBe('Home & DIY')

    const card = pendingCard(page, 'Move Bubble Stale Sample.')
    await expect(card).toContainText('Home & DIY', { timeout: 20_000 })
    await expect(await decide(page, card, 'Apply')).toContainText('Home & DIY → Clothing')
    expect(await moved()).toBe('Clothing')
  })

  test('R-008: a typed yes cannot apply a card that was just replaced', async () => {
    await clearChats()
    const { moved, makeStale, telegramCard } = await staleMove('Typed Stale Sample', 'telegram')
    await app.cardShown()
    await makeStale()
    stub.text(DANIEL, 'yes')
    await expect.poll(() => telegramCard!.text, { timeout: 15_000 }).toContain('nothing was applied')
    app.fakeReply(answer('Tap Apply on the updated card.'))
    const count = stub.sent.length
    stub.text(DANIEL, 'yes')
    await stub.reply_after(count, m => m.text === 'Tap Apply on the updated card.')
    expect(await moved()).toBe('Home & DIY')
  })

  test('R-023: the result says what was really saved, even if Claude described it wrongly', async () => {
    await clearChats()
    const clothing = await app.category('Clothing')
    await app.json(`/budget?month=${d.label}`)
    const proposal = (cents: number) => ({
      kind: 'propose', summary: 'Lower the Clothing budget to €50,00.', op: 'budget.set',
      args: { category_id: clothing.id, month: d.label, planned_amount_cents: cents },
    })
    app.fakeReply(proposal(99900))
    await say(page, 'lower clothing to 50')
    const card = pendingCard(page, 'Lower the Clothing')
    await expect(card).toBeVisible()
    const done = await decide(page, card, 'Apply')
    await expect(done).toContainText('Done.')
    await expect(done).toContainText('Budget for Clothing')
    await expect(done).toContainText('→ €999,00')
    await expect(done).not.toContainText('Lower the Clothing')

    app.fakeReply(proposal(88800))
    const count = stub.sent.length
    stub.text(DANIEL, 'lower clothing to 50')
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
    const split = (refund: boolean) => ({
      kind: 'propose', summary: refund ? 'Split it.' : 'Stop the refund part.', op: 'transaction.split',
      args: { id: row.id, parts: [{ category_id: clothing.id, amount_cents: 2000, is_refund: refund }, { category_id: salary.id, amount_cents: 3000 }] },
    })
    app.fakeReply(split(true))
    await say(page, 'split it')
    const card = pendingCard(page, 'Split it.')
    await expect(card).toContainText('Clothing €20,00 (refund) + Salary €30,00')
    const done = await decide(page, card, 'Apply')
    await expect(done).toContainText('Clothing €20,00 (refund) + Salary €30,00')

    app.fakeReply(split(false))
    await say(page, 'that part was not a refund')
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
    app.fakeReply(await addProposal('Sample Garbled Press')())
    const count = stub.sent.length
    stub.text(DANIEL, 'add the garbled one')
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
    const book = { kind: 'propose', summary: 'Book the twin.', op: 'refund.book', args: { refund_id: refund.id, purchase_id: purchase.id } }
    const ask = (sign: number) => [
      { reply: { kind: 'choices', transaction_ids: twins.filter(t => Math.sign(t.amount_cents) === sign).map(t => t.id) } },
      { reply: answer('Which one?') },
    ]
    app.script([{ reply: book }, ...ask(1), { reply: book }, ...ask(-1), { reply: book }, { reply: answer('Here it is.') }])
    await say(page, 'the twin shop gave it back')
    for (let round = 0; round < 2; round++) {
      const options = page.locator('.chat-options').last()
      await expect(options.getByRole('button')).toHaveCount(2)
      const before = await page.locator('.chat-options').count()
      await options.getByRole('button').first().click()
      if (round === 0) await expect(page.locator('.chat-options')).toHaveCount(before + 1)
    }
    await expect(pendingCard(page, 'Book the twin.')).toBeVisible()
  })

  test('R-015 R-023: when an answer is lost on the way back, the screen follows what really happened', async () => {
    await clearChats()
    app.fakeReply(await addProposal('Sample Lost Response')())
    await say(page, 'add the lost one')
    const card = pendingCard(page, 'Sample Lost Response')
    await expect(card).toBeVisible()
    await page.route('**/chat/proposals/*/apply', async route => { await route.fetch(); await route.abort() })
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('[data-state="applied"]', { hasText: 'Sample Lost Response' })).toBeVisible({ timeout: 20_000 })
    await page.unroute('**/chat/proposals/*/apply')
    expect((await app.transactions()).filter(t => t.description === 'Sample Lost Response')).toHaveLength(1)

    app.fakeReply(answer('Heard the lost message.'))
    await page.route('**/api/chat/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fetch()
      await route.abort()
    })
    await say(page, 'lost on the way back')
    await expect(page.locator('.chat-reply', { hasText: 'Heard the lost message.' })).toBeVisible()
    await page.unroute('**/api/chat/messages')
    await expect(page.locator('.chat-error[role="alert"]')).toHaveCount(0)
    await expect(page.getByLabel('Message')).toHaveValue('')
  })

  test('R-015: the bot says what it knows when the app answers with an error', async () => {
    let status = 500
    const fakeApp = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/chat/outbox')) { res.end(JSON.stringify({ replies: [], in_flight: [] })); return }
      res.statusCode = status
      res.end(JSON.stringify({ detail: 'no' }))
    })
    await new Promise<void>(resolve => fakeApp.listen(18713, '127.0.0.1', resolve))
    const other = new TelegramStub(18714)
    await other.start()
    const stop = startBot(other, 'http://127.0.0.1:18713')
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
    app.fakeReply(await addProposal('Sample Late Press')())
    stub.text(DANIEL, 'add the late one')
    const card = await stub.reply_after(count, isCard)
    await app.cardShown()
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
    app.fakeReply(await addProposal('Sample Unseen Card')())
    await app.post('/chat/messages', { channel: 'telegram', text: 'add it' })
    await app.settled('telegram')
    await app.post('/chat/messages', { channel: 'telegram', text: 'ok' })
    await app.settled('telegram')
    expect(await rowCount()).toBe(before)

    // In the bubble too: a yes from a screen that has not got the card yet does nothing.
    await app.post('/chat/new', { channel: 'bubble' })
    app.fakeReply(await addProposal('Sample Unseen Bubble')())
    await app.post('/chat/messages', { channel: 'bubble', text: 'add it' })
    await app.settled('bubble')
    await app.post('/chat/messages', { channel: 'bubble', text: 'yes', seen_message_id: 0 })
    await app.settled('bubble')
    expect(await rowCount()).toBe(before)
    stopBot = startBot(stub, `${app.base}/api`)
    await app.post('/chat/new', { channel: 'telegram' })
  })

  test('R-015 R-029: replies reach Telegram after the app restarts mid-message', async () => {
    await clearChats()
    app.fake({ delay: '20' })
    const count = stub.sent.length
    stub.text(DANIEL, 'Will Telegram hear about this?')
    await expect.poll(() => app.json('/chat/messages?channel=telegram').then(c => c.messages.length), { timeout: 15_000 }).toBeGreaterThan(0)
    await new Promise(resolve => setTimeout(resolve, 1500))
    await app.stop()
    app.fake({ delay: '0' })
    app.fakeReply(answer('Telegram heard after the restart.'))
    const told = await stub.reply_after(count, m => m.text.includes('stopped while'))
    expect(told.text).not.toContain('nothing changed')
    await app.start()
    await stub.reply_after(count, m => m.text === 'Telegram heard after the restart.')
  })

  test('R-005 R-015: an import interrupted by a restart still ends in its summary', async () => {
    await clearChats()
    app.fake({ delay: '20', reply: '[{"index":0,"category":"Clothing","confidence":0.9}]', mode: 'reply' })
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
    app.fakeReply({ ...await addProposal(`Sample Long ${'x'.repeat(4200)}`)(), summary: 'Add the long one.' })
    stub.text(DANIEL, 'add the long one')
    const card = await stub.reply_after(count, isCard)
    // Questions about earlier imports may arrive in between; they are not part of this card.
    const isQuestion = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat().some((b: any) => b.text === 'Something else') || / sorted| Sorted/.test(m.text)
    const parts = () => stub.sent.slice(count).filter(m => !m.deleted && !isQuestion(m) && !/^(Working on it|Stopping)/.test(m.text))
    expect(parts()).toHaveLength(1)
    expect(card.text.length).toBeLessThanOrEqual(4096)
    expect(card.text).toContain('Add: Sample Long xxxx')
    await app.cardShown()
    stub.tap(DANIEL, card, stub.button(card, 'Apply'))
    await expect.poll(() => card.text, { timeout: 15_000 }).toContain('Applied.')
    expect(parts()).toHaveLength(1)
    expect((await app.transactions()).filter(t => t.description.startsWith('Sample Long ') && t.description.length > 4200)).toHaveLength(1)
  })

  test('R-024: no sign-in step and no wording that assumes who is looking', async () => {
    await clearChats()
    await page.reload()
    await openChat(page)
    await expect(page.locator('.chat-empty')).toBeVisible()
    const copy = await page.locator('dialog.chat-dialog').innerText()
    expect(copy).not.toMatch(/daniel|partner|sign in|log in/i)
    const prompt = readFileSync(path.join(repo, 'backend', 'assistant', 'prompts.py'), 'utf8')
    expect(prompt).not.toMatch(/daniel/i)
    await say(page, 'hello')
    await expect(page.locator('.chat-reply').last()).toContainText('Scripted')
  })
})
