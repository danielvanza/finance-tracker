# Chat insights: pattern questions over any period

## Starting point and direction

**Starting point.** Daniel asked how to make the finance bot better with more features. The bot (Telegram and web chat share one brain) answers "how are we doing this month" well. It cannot answer open questions such as "what patterns do you see in the last 3 months?" in any depth.

**Converged direction.** Let the bot answer open questions about category trends, merchant habits and repeating payments, over any period the person names, in Telegram and the web chat. It answers with text and, when a picture helps, a chart. For whom: the two members of the household.

## Decisions

- **First priority is insight and trends.** Reaching out first, and faster daily upkeep, were not chosen.
- **All three question kinds count:** category trends, merchants and habits, recurring payments. One general feature, not three.
- **Look-back is on demand.** Default stays the current month plus 3 previous months. Anything older is fetched only when a question needs it, and any imported month must be reachable. History is never loaded into context all the time.
- **Data access is free-form read-only queries.** Claude writes the queries; the app runs them read-only and returns rows; Claude reasons over the rows. Claude never connects to the database itself.
- **Query surface is both:** app-made views (financial month, splits, refunds, exclude category already resolved) plus raw transaction rows. Everything else stays unreachable.
- **Effort limit:** about 5 query rounds and about 3 minutes per question, then a partial answer that says so. Matches today's 180 s cap and the one-message-at-a-time queue.
- **Transparency:** a short "based on" line on each analytical answer, with no query text.
- **Charts when they help, in the same feature,** in both Telegram and the web chat. The app draws them from the queried data; Claude does not draw.

## Out of this version (explicit exclusions)

- Messages from the bot that nobody asked for (reminders, alerts, scheduled summaries).
- Forecasts and advice. The bot reports and explains what happened.
- Changing data from an insight. Insights are answers only. Existing "change this" requests work as today.

## Alternatives considered

- **Fixed menu of named lookups.** Recommended by the assistant because it reuses the app's own rules, so answers match the Month page. Rejected by Daniel in favour of free-form flexibility. The correctness risk is handled by exposing app-made views (R-004) instead of only raw tables.
- **Real tools inside the Claude sandbox.** First rejected, because it could remove today's guarantee that Claude cannot change anything. Later chosen by Daniel in a narrow form: only the app's own read-only query and reply tools, with built-in tools still off, so the guarantee holds.
- **Raw tables with a schema guide only.** Rejected: totals could drift from the app.
- **Charts as a follow-up.** Recommended by the assistant, since a chart of a wrong number is worse than none. Daniel chose to include charts in this feature.
- **Longer effort limit (about 10 rounds, 10 minutes).** Rejected: a long question would block the other person's messages.

## Grounding notes

Checked in the code, not tested live:
- `backend/assistant/brain.py`: the prompt holds the current month, 3 previous months by category, and at most 40 recent, 25 incoming and 50 matched transactions. Claude has no tools and returns one JSON object (`answer`, `clarify` or `propose`).
- `backend/categorizer/claude_cli.py`: the `bwrap` sandbox, `--tools ""`, one run at a time, 180 s timeout.
- `backend/assistant/service.py`: one chat-worker thread works through queued messages in order.
- `PRODUCT.md`: the household shares one login; replies must stay neutral about who is writing.
- A separate, earlier feature folder exists: `thoughts/features/2026-11-09-finance-chat-assistant/`. This feature builds on that chat and does not change its requirements.

## Optional wishes and carried-forward uncertainties

Not agreed scope:
- Whether queries and their results must stay out of application logs. The Telegram bot already avoids logging message text.
- Which views to build and their exact columns.
- The row cap and the per-query time limit; to be chosen during build.
- How a chart is described by Claude and drawn by the app.
- Later ideas: unprompted reminders and summaries, adding a transaction by photo, importing Revolut or DEGIRO from Telegram.
