# Brainstorm: Finance chat assistant

Agreed 2026-11-09. The authoritative list is [requirements.md](requirements.md).

## Starting point

Daniel wanted to manage the budget through Telegram, either in a new chat or through Hermes Arnold, in two ways: drop in an ING sheet and have it imported, and say in plain text what happened (for example, that something was refunded against an earlier purchase) instead of recording it carefully through the UI. During the interview he added a chat bubble inside the app that does the same things, running on the Claude subscription as Roadmap Studio does.

## Converged direction

One finance assistant, reached two ways: a private Telegram bot for Daniel and a clay chat bubble on every page of the app. Dropping in an ING CSV imports it straight away and reports what landed. Plain language can ask about the budget or change anything in the app, but every change is shown field by field and applied only after one Yes. It serves the household's core product problem: the routine has lapsed before, so recording what happened has to be small enough to keep up.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Telegram channel | Separate finance bot, not Arnold | Daniel's choice. Keeps money out of Arnold's chat and the coaching logs. |
| Who uses Telegram | Daniel only for now | Sharing with his partner is wanted later (D-001). |
| Dropping a file | Import, then summarise | One-step routine. Duplicates make a re-send harmless. Review stays in the app unless asked. |
| Text scope | Everything in the app | Daniel's choice over transaction fixes only. |
| When changes apply | Confirm every change | Loose text can match the wrong row, and a tap is cheap. No undo is needed. |
| Refund bookkeeping | Net in the month the money arrived | Matches how the app already works and leaves past months alone. |
| Item not imported yet | Add a manual entry now | Daniel's choice, so a change can be recorded when it happens. |
| Resulting double count | Flag after import, one tap to merge | Keeps the confirm-every-change rule. |
| Questions and review by chat | Both, only when asked | What "everything in the app" means in practice. |
| AI behind both chats | One assistant on the Claude subscription | Daniel asked for the subscription here. One assistant keeps the two chats consistent. |
| Open button | F1 A: round clay button | Stays reachable without a nav change. Vermilion is reserved for the page's main action. |
| Computer panel | F2 A: side panel, page stays usable | Figures can be seen moving beside the chat. |
| Change confirmation | F3 B: field by field | Daniel's choice over the recommended sentence plus effect, for a more thorough check. |
| Files in the bubble | F4 A: attach button and summary card | Parity with Telegram. |
| First open | F5 A: what it can do, plus starters | Explains itself without repeating the page. |
| Bubble history | One saved conversation, shared by both people, separate from Telegram | The app has one shared sign-in and no per-person accounts. Daniel accepted that his partner can read it. |

**Smallest useful scope:** the requirements above. **Excluded:** Revolut and DEGIRO files through chat, voice messages, undo, a stored link between a refund and its purchase, moving refunds to the purchase month, remembering instructions until a matching payment arrives, reminders that an import is due, and fixing the app's existing 41px buttons.

## Alternatives rejected

- **Arnold's chat:** coaching logs would capture amounts and shop names, and persona and finance would mix.
- **Shared bot with partner now:** most setup, and raises who-can-change-what questions before the basics work.
- **Preview before import, or review in chat after every import:** extra steps or dozens of messages after a long gap.
- **Transaction fixes only, or refunds only:** Daniel wanted the full reach.
- **Confirm only big changes, or apply with undo:** a wrong match would reach the books, and undo would be needed for every kind of change.
- **Visible refund link, or moving the refund to the purchase month:** new data and screen work, or reworking month logic and changing past totals.
- **Remember and apply later, or tell the user to send the file:** Daniel preferred recording immediately.
- **Automatic merging:** two genuinely separate same-amount payments could be merged wrongly.
- **Labelled pill or fifth tab; floating card or dimmed panel; sentence plus effect or Yes/No reply; plain-sentence summary or sending users to the Import page; month status first or an empty box:** compared visually, not chosen.

## Grounding notes

- Refunds, splits, manual transactions and duplicate handling already exist: `backend/models.py`, `backend/routers/transactions.py`, `backend/routers/imports.py`. Manual entries get a unique hash, which is why a later bank row counts twice.
- ING parsing reads English column headers only: `backend/importers/ing.py`. Unknown headers produce zero rows silently today.
- The Claude subscription is already wired up in a sandbox: `backend/categorizer/claude_cli.py`, enabled by `CLAUDE_CLI_HOME` in `deploy/household-finance.service`. One Claude run happens at a time.
- Roadmap Studio's reference: `server/providers/claude.ts`, `server/providers/isolation.ts`, `server/assistant/assistant.ts`, `web/src/components/Assistant.tsx`, `web/src/components/assistant.css` in `/home/daniel/code/roadmap-studio`.
- Hermes facts: `/home/daniel/vaults/Brain/projects/hermes-agent.md`. Arnold's default profile uses OpenAI, and its Telegram conversations are copied to the coaching logs.
- Product and design context: `PRODUCT.md`, `/home/daniel/code/life-dashboard/DESIGN.md`, `frontend/src/styles/`. The app's `.btn` renders at about 41px on a 15px root.
- Concept images, built on the uncommitted redesign in the working tree with sample data: `/home/daniel/artifacts/household-finance/chat-bubble-concepts/` (`F1.jpg` to `F5.jpg`).

## Optional wishes

- Share the Telegram bot with Daniel's partner (D-001).

## Carried-forward uncertainties

- How the Telegram bot runs, as long as R-001, R-016 and R-017 hold. Daniel will need to create the bot with BotFather and supply its token.
- What counts as a "close date" when flagging double entries.
- Whether Daniel's real ING export uses the English headers the importer reads. A Dutch export would be refused under R-006 until handled.
- How long a chat may wait behind import sorting, given one Claude run at a time.
- The redesign the concepts are built on was uncommitted when this was written, and execution should build on whatever has landed by then.
