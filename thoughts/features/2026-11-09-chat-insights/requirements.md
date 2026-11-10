# Requirements: chat insights

Feature folder: `thoughts/features/2026-11-09-chat-insights/`. Decision context is in `brainstorm.md`.

## Active requirements

### R-001 — Deeper pattern questions
The bot answers open questions about category trends, merchant habits and repeating payments beyond the 3 months it normally sees, in Telegram and in the web chat.

**Acceptance:** With 6 or more months of data, "which categories rose over the last 6 months?" names categories with monthly figures taken from months older than the 3 loaded by default. A merchant question names merchants with totals. A repeating-payments question lists the repeating charges with their amounts, and shows the old and new amount when one changed. The same questions work in the web chat.

### R-002 — Look back on demand
The default snapshot stays as it is today. Older or wider data is fetched only when a question needs it, and any imported month can be reached.

**Acceptance:** "how are we doing this month?" triggers no extra data request. A "last 12 months" question fetches the months it needs. The default snapshot does not grow as history grows.

### R-003 — Read-only data requests
Claude requests data by writing queries that the app runs. Claude has no direct access to the database or to files. Claude sends them through real tool calls, served by the app to that one run; built-in tools (shell, files, web) stay off.

**Acceptance:** A query that inserts, updates, deletes, changes structure or runs more than one statement is refused and no data changes. The sandbox around Claude stays as it is today, except that its only tools are the app's own read-only query tool and reply tools.

### R-004 — Allowed data
Queries run against app-made views, which already resolve the financial month, splits, refunds and the exclude category, and against raw transaction rows. Nothing else can be reached.

**Acceptance:** A query on chat messages, proposals or settings fails. For a category and a month, the views give the same total as the Month page, including a case with a split transaction, a refund and a non-default month start day.

### R-005 — Capped results
Each query has a row cap and a time limit. When a result is cut off, Claude is told.

**Acceptance:** A query that would return the whole ledger returns the capped rows, marked as cut off, and the answer does not claim to be complete.

### R-006 — Effort limit
One question gets up to about 5 query rounds and about 3 minutes. At the limit, the bot gives its best answer so far and says it stopped early.

**Acceptance:** A question that would keep querying still ends with a reply within about 3 minutes, and the reply says it is partial.

### R-007 — Progress while digging
While a deep question runs, the person can see that the bot is working.

**Acceptance:** A question that takes more than a few seconds shows a note or typing indicator in Telegram and a working state in the web chat. The existing "waiting for Claude" note still appears when the message is queued behind another.

### R-008 — "Based on" line
Each analytical answer ends with one plain line saying which data and period it used. It shows no query text.

**Acceptance:** The line names the categories or merchants and the period, and says whether refunds are counted. No query text appears in the reply.

### R-009 — Honest limits
Every figure in an answer comes from query results. If the data has gaps, such as bank files that stop early or missing months, the answer says so. If a query fails or the question cannot be answered, the bot says so and changes nothing. Claude cites figures by reference to query results and the app fills them in; an analytical answer with a typed figure or a spelled-out amount is refused. Matching each figure to the right month or category is left to Claude.

**Acceptance:** When part of the asked period has no data, the reply names the gap. A failed query produces a plain sentence and no made-up number.

### R-010 — Insights are answers only
A pattern question never creates a card or changes data. A request to change something still gets its card, even when finding the rows took a look into the history.

**Acceptance:** After a pattern question, no proposal exists. Existing flows (refund, recategorise, import, Apply and Not this, typed yes or no) behave as before.

### R-011 — Charts when they help
When a trend is clearer as a picture, the app draws a chart from the same queried data and sends it with the text answer, in Telegram and in the web chat. Claude does not draw it. The chart is drawn from a query result the answer cites; matching each figure in the text to the right month or category is left to Claude.

**Acceptance:** "show spend per category over 6 months" delivers an image in both chats next to the text answer, and the chart's numbers match the text. A single number gets no chart. If the chart cannot be made, the text answer still arrives with a short note.

## Out of scope for this version

Excluded by decision, not retired requirements:
- Unprompted messages from the bot (reminders, alerts, scheduled summaries).
- Forecasts and advice.
- Changing data from an insight.

## Deferred and retired

None yet.

## Change history

- 2026-11-09: R-001 to R-011 agreed and locked.
- 2026-11-09: R-009 and R-011 clarified by Daniel after review: the app refuses figures it cannot find in the results and spelled-out amounts, and matching a figure to the right month or category is left to Claude, since Claude writes the sentences.
- 2026-11-09: R-003 and R-009 updated at Daniel's request: Claude uses real tools (a read-only query tool and reply tools served to that one run) instead of a JSON protocol, replacing the earlier decision against tools in the sandbox, and figures in analytical answers are references the app fills in. Built-in tools stay off.
- 2026-11-10: R-010 clarified by Daniel after live use: a change the person asks for gets its card even after a lookup (for example reviewing imported guesses, or moving an older payment described without its name). Keeping pattern questions card-free now rests on Claude's instructions and the tool descriptions, not on a hard block.
