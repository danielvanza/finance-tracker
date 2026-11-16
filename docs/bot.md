# The chat on bot-kit

Finance's chat runs on the shared bot kit (vendored in `vendor/`, Python package `botkit`; its `SPEC.md` is the
authority for everything not finance's own). This page is what finance adds on top: its message kinds, their payloads,
its buttons and what its cards carry. The bubble (`frontend/src/chat/`) and the Telegram front are both built on
exactly this.

- **Where:** the kit's HTTP API (SPEC §9) is mounted at `/api/chat` (`backend/main.py`). Channels: `bubble` (the app's
  chat) and `telegram` (the household's group). Each has its own conversation.
- **Code:** `backend/assistant/bot.py` (the `Bot`: instructions, context, tools, card kinds, handlers, actions, history,
  starters, chart pictures), `backend/assistant/questions.py` (questions about unsure payments, unasked messages),
  `backend/assistant/prompts.py` (what Claude is told), `backend/assistant/actions.py` (every change: preview + apply).
- **Store:** the kit's SQLite file, `BOT_DB_PATH` (default `bot.db` beside the finance database). The Alembic revision
  `c5e8b2a7d913` copied the old `chat_messages` / `chat_proposals` into it, keeping message and card ids, and dropped them.

## Message kinds

`role` and `kind` of every message finance makes, besides the kit's own (`text`, `answer`, `error`, `card`,
`new_chat`). `payload` is a JSON object; `buttons` (SPEC §7) are on the message JSON.

| role | kind | text | payload | buttons |
|---|---|---|---|---|
| user | `text` | what was typed | `choice_id?` (a "which one?" tap), `page?`, `ended?` (`stopped`/`time`) | — |
| user | `file` | caption (usually empty) | `filename`, `size` | — |
| user | `photo` | caption | `filename`, `size` | — |
| user | `voice` | **what was heard** (set by the handler before the reply; empty until then) | `filename`, `size` | — |
| assistant | `answer` | Claude's words (`**bold**`, `- ` list lines) | `options?` ("which one?"), `chart?` + `image?` (a chart), `about_question?` + `transaction_ids?` (the app asking what a payment is, after Something else) | — |
| assistant | `all_rows` | every row of a card, as plain text | `groups`, `card_id` | — |
| assistant | `import` | the import in one sentence | counts (below) | — |
| assistant | `question` | the question in one line | question (below), `unasked?` | answers, Something else; once answered: Remember |
| assistant | `nudge` | the unasked message (recap, old data, month end), a few lines | `nudge` (`close`, `recap`, `stale`, joined with `+`), `unasked: true` | — |
| assistant | `card` | the card's summary | `says?` (on the card JSON), `remembered?` | card buttons (below) |
| assistant | `error` | the plain reason; always says what did not happen | — | — |

### Payloads

- **"Which one?"** (`answer` with `options`): `[{id, label, detail}]`, at most 10. `id` is a transaction id, `label` its
  name, `detail` `"{date_label} · {amount_label}"` (e.g. `12 Nov · -€4,50`). A tap sends `POST /messages {channel,
  choice_id}`; it is saved as the person's text `That one: {name}, {date_label}, {amount_label} (id {id})`.
- **Chart** (`answer`): `chart = {type: line|bars, title, labels: [..], series: [{name, values}], unit}`; `image =
  {alt}`. The picture is `GET /messages/{id}/image?theme=day|night` (PNG). The answer's words carry the same figures.
- **Every row of a card** (`all_rows`): `groups = [{heading, rows: [{when, amount, name}]}` or
  `{heading, lines: [str]}]`. Payment groups first (by size), then `Remembered for next time`, then `Other changes`.
  `text` is the same as plain text (`actions.details`).
- **Import** (`import`): `{imported, skipped, by_rule, by_ai, doubtful, uncategorised, noted}`. Waiting for an answer
  is `doubtful + uncategorised`; sorted and counted is `by_rule + by_ai`; `noted` rows already in got the bank's note.
- **Question** (`question`): `{status: open|answered, key, name, incoming, transaction_ids, count, total_cents,
  examples: [{date_label, amount_label, description, note}] (up to 3), options: [{category_id, label, refund}],
  result?, offer?: {transaction_id, label}, asked_what?}`. Unasked questions (after a Setup/Import page import, or
  the morning catch-up) carry `unasked: true`. A question whose payments were sorted another way is closed before
  any front reads the channel (`refresh`): `status: answered`, `result: "Sorted as X."`, no buttons, and `refresh`
  set if it was delivered, so a push front edits it.

### Buttons and actions

`POST /api/chat/messages/{id}/actions/{action} {value?}` returns the message as it is now.

| on | action | label | value | does |
|---|---|---|---|---|
| open question | `answer` | the option's label (≤ 60 chars) | option index | sorts its payments (and the shop's other waiting ones), `status: answered`, `result` `"{label}. N payments sorted."`, offers to remember the shop (`offer`), asks the next question |
| open question | `something_else` | Something else (`style: quiet`) | — | posts an `answer` asking what it is (`about_question`), once (`asked_what`) |
| answered question | `remember` | `Remember {shop} for next time` | — | makes the rule, appends what was remembered to `result`, removes the offer |
| open, summed-up card (not in the bubble) | `show_all` | `Show all N payments` / `Show all N rows` (`style: quiet`) | — | posts an `all_rows` message |
| applied card that sorted shops | `remember_shops` | `Remember {shop} for next time` / `Remember these N shops` | — | makes a rule per shop; card message `payload.remembered` says what was remembered |

The bubble folds every row of a summed-up card out itself ("Show all N rows"), so it has no Show all button. Typing
`show all` (and the other words in `bot.SHOW_ALL_WORDS`) to the one card in front of the person runs `show_all`, like a
typed yes or no (SPEC §5.6).

## Cards

Every change in `actions.OPS` is a `card` kind (finance has no immediate changes), named as in `OPS`
(`transaction.add`, `review.confirm`, `batch` …); `merge` is offered by an import only (`bot.offer`), never by Claude,
and survives New chat. Labels: no heading (`""`) and Apply / Not this; `merge`: heading "Looks like the same
payment", Merge, Keep both. The kit's card JSON (SPEC §6) has `lines` (what will change in the app's words: a line per
change, or a count and a line per category when there are many) and:

**`data`** (from the preview; what the card shows before Apply):

| field | what |
|---|---|
| `changes` | `[{title, fields: [{label, before, after}], payment?}]`: every row the change touches |
| `purchase` | for a refund: the purchase `{id, date, date_label, amount_cents, amount_label, description, category}`, else null |
| `effect` | `[{category, when, before_cents, after_cents, planned_before_cents, planned_cents}]` |
| `effect_lines` | the budget effect in words, before → after, biggest first (`Food this month: €120,00 → €127,50 of €350,00`) |
| `summed_up` | true when the card sums many rows up; then the rows are shown on request |
| `rows`, `payments` | how many rows, how many of them payments |
| `head`, `short_lines` | a summed-up card's count (`85 payments`) and its lines without the shops, for a chat that keeps a card short |
| `applied_line` | a summed-up card, once applied, in one sentence |

**`result`** (once applied): `applied_text` (what was saved, in the app's words), `effect`, `effect_lines` (the budget
lines as they stand now, without the before), `waiting?` (payments still waiting, when the card sorted waiting ones),
`offer?: {transaction_ids, label}` (Remember these shops). What was remembered is the card message's
`payload.remembered`.

A card's `status` is the kit's: `open | applying | applied | rejected | superseded | failed`. Before the move it was
`pending` for `open`; Claude is still shown `pending` in its conversation.

## What Claude is given

`<context>`: `today`, `payments_waiting_for_an_answer`, `this_month` (the Month page overview). `<conversation>`: each
message as it always was: the person's words (`sent_a_bank_file`, `sent_a_photo`, `heard_from_a_voice_note`, Stop
noted), Claude's own words (`choices_shown`, `chart_shown`), cards (`id, summary, op, rows_changed, status, args?,
error?`, `you_said_with_it`), `asked` questions with their `buttons` and `outcome`, `sent_unasked`, `import_summary`,
`asked_after_something_else`, errors. Tools: `month_overview`, `run_query` (a private in-memory copy per reply, closed
when it ends), `show_chart`, and the kit's `make_change` and `show_choices`.

## Starters

`GET /api/chat/starters?channel=bubble&page=<route>`: Month (`/`): how the month is going, a refund, and the review
when payments wait; Transactions: the review, a refund, a cash payment; Import: what the last import brought, where
the bank data stops, the review; Trends: the last six months, spending per category; Setup: whether the plan fits,
yearly bills; Report: last month in a few lines, where most of it went.

## Telegram

`backend/telegram_bot.py` is the kit's Telegram front (`botkit.telegram`, SPEC §11) with finance's renderers: `card`,
`question`, `answer` (with "which one?" choices and a chart sent as a photo from `/messages/{id}/image`), `all_rows`,
`import`, `nudge`, `error`; the live log of a voice note and the first reply to it start with `Heard: “…”`; and the
words the bot says itself. Buttons carry the kit's callback data (`a:` Apply, `r:` reject, `c:` a choice, `b:` a
message's action, `s:` Stop); buttons on messages sent before the move (`q:{question}:{n|x|m}`, `d:{card}`,
`m:{card}`) still work (`legacy_callback`). Its calls, before the move → now:

| old | new |
|---|---|
| `GET /chat/messages?channel=` (`messages`, `guesses_waiting`, `claude_busy`) | `GET /chat/conversation?channel=` (`conversation`, `messages`, `busy`) |
| `POST /chat/messages {channel, text, choose_transaction_id}` | `POST /chat/messages {channel, text}` or `{channel, choice_id}`; a typed yes/no/show all comes back `status: done` with no `card` (read the card's message) |
| `POST /chat/files` (multipart `channel`, `file`) | `POST /chat/uploads/file` (multipart `channel`, `file`, `caption?`) |
| `POST /chat/voice` → `{heard}` or `{heard: null, too_long?}` at once | `POST /chat/uploads/voice` → the saved message; heard in the background: the message's `text` becomes what was heard, or an `error` reply says it could not be made out or was too long |
| `POST /chat/photos` (`channel`, `caption`, `file`) | `POST /chat/uploads/photo` (same fields); an unreadable picture gets an `error` reply |
| `GET /chat/outbox` (`replies` with `heard`, `edits`, `in_flight` with `heard`) | `GET /chat/outbox` (`replies`, `edits`, `in_flight`); what was heard is the `text` of the voice message a reply's `reply_to` names |
| `POST /chat/messages/{id}/delivered {message_ids}` | `POST /chat/messages/{id}/delivered {ids}`; a message's `delivered` holds them (was `delivered_ids`) |
| `GET /chat/messages/{id}/chart?theme=` | `GET /chat/messages/{id}/image?theme=` |
| `POST /chat/proposals/{id}/apply {version}` → card | `POST /chat/cards/{id}/apply {version}` → the card's message |
| `POST /chat/proposals/{id}/reject` → card | `POST /chat/cards/{id}/reject` → the card's message |
| `POST /chat/proposals/{id}/remember` → card | `POST /chat/messages/{card message id}/actions/remember_shops` |
| `POST /chat/proposals/{id}/show-all` | `POST /chat/messages/{card message id}/actions/show_all` (posts an `all_rows` message) |
| `POST /chat/questions/{id}/answer {option}` | `POST /chat/messages/{id}/actions/answer {value: option}` |
| `POST /chat/questions/{id}/something-else` | `POST /chat/messages/{id}/actions/something_else` |
| `POST /chat/questions/{id}/remember` | `POST /chat/messages/{id}/actions/remember` |
| `POST /chat/stop {channel}`, `POST /chat/new {channel}` | the same paths; `/new` returns `{conversation}` |

Shapes that moved: kind `proposal` is now `card`, `clarify` is now `answer` with `options` as `{id, label, detail}`
(was transaction refs), a show-all answer is kind `all_rows`; a card's fields `summed_up`, `rows`, `payments`, `head`,
`short_lines`, `applied_line`, `effect_lines`, `purchase`, `changes`, `effect` are under `card.data`; `waiting`, `offer`
(now `{transaction_ids, label}`, was the label) and the applied `effect_lines` under `card.result`; `remembered` is the
message's `payload.remembered`; `card.message_ids` is the message's `delivered`; the live log is the person's message's
`steps` (was `payload.steps`); card status `pending` is `open`.
