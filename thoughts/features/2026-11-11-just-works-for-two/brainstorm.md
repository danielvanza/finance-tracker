# Just works for two: a group bot, numbers that can be trusted, a simpler budget

## Starting point and direction

**Starting point.** Daniel asked for a review of the whole app: what is missing, what can be removed (naming standing adjustments), how established budgeting tools work, and a deep test of the Telegram bot so that it works for him and for his girlfriend, who is not technical. "It should just work."

**What the review found.** The bot's core works, but only for one Telegram account. The larger problem is the data: 400 of 434 payments in production were unreviewed guesses that count nowhere, only 4 rules existed, and bank data stopped 11 days back. Every answer the bot gave had to say the real picture was probably different.

**Converged direction.** One feature, for both members of the household:
- The bot moves to a group chat, takes text, voice notes, photos and ING files, replies briefly, and writes first when it matters.
- Guesses Claude is sure about count on their own; only doubtful ones are asked, and each answer is remembered.
- The budget covers the shared account only, leads with "free to spend until payday", spreads yearly bills, and measures against the household's own target split.
- Parts that add little are removed.

## Decisions

- **Scope: everything in one definition, except automatic bank import.**
- **Partner access: one group chat for the bot and both people.** Either can ask and either can apply a card. The group is the only Telegram conversation.
- **Guesses: trust sure ones, ask the rest.** Each answer is remembered per shop.
- **Unasked messages: all three offered.** Old-data nudge, weekly recap, payday month close.
- **Voice and photos: both understood.** Daniel's answer was "Everything. Photos, text to speech etc."; read as the bot understanding voice notes and photos and replying in text.
- **Standing adjustments: dropped.** The budget covers the shared account only. Money moved back to a personal account mid-month counts as spending in its own category.
- **Headline: "free to spend until payday"** replaces "left".
- **Yearly and irregular bills: set-asides.**
- **50/30/20: replaced by the household's own target split,** three percentages set in Setup.
- **Banks: ING only for now.** Revolut and DEGIRO importers and mentions are cleaned up; DEGIRO may return later.
- **Removed:** rule priority, the "Refunds" income category, the "Counts as" picker on Month, the JSON backup download, unused code and stale documents.

Defaults chosen without a question and accepted at lock-in: a private message points to the group; recap on Sunday around 18:00; "old" means more than 7 days; nothing unasked at night; savings goals unchanged; the "DEGIRO" savings category stays.

**Smallest useful scope.** The whole list was chosen as one piece. If it has to be cut, the group bot (R-001 to R-003, R-006) and automatic handling of guesses (R-011 to R-014) are what make the numbers usable for two people; the rest builds on them.

**Explicit exclusions.** Automatic bank import; per-person figures or accounts; spoken replies; a net-worth or investment view; changes to savings goals.

## Alternatives considered

- **Own private chat each, or private chats plus a group.** Offered as the simpler default; Daniel chose one group so both see everything.
- **Count every guess and check later.** Least work, but a transfer guessed wrongly as income or spending would silently distort the month. Not chosen.
- **Keep confirming every guess, grouped per shop.** Keeps full control but still leaves a pile to work through. Not chosen.
- **Read captions only and decline voice and photos.** Recommended as cheapest, since the bank file already holds every card payment. Daniel chose to support everything.
- **One "kept outside the shared account" setting in place of standing adjustments.** Considered; dropped in favour of covering the shared account only.
- **Money moved to personal accounts as a smaller contribution, or ignored.** Rejected: the money has left the shared pot, so it should lower what is free to spend.
- **Keep "left", or show "left" and "free to spend" together.** Not chosen; one number.
- **Mark a big bill as a one-off, or leave yearly bills alone.** Not chosen; set-asides.
- **Keep the three groups without targets, or keep 50/30/20.** Daniel chose a target split of their own.
- **ING and Revolut, or all three banks.** Not chosen; importing the other accounts would count the same money twice.
- **Full envelope budgeting, receipt-only capture, streaks, a chatbot personality.** Seen in other tools and judged overkill for this household.

## Grounding notes

Checked on 2026-11-11.

**Production, read-only** (`~/.local/share/household-finance/finance.db`): 434 payments from 1 Aug to 1 Nov, all ING; 400 unconfirmed AI guesses; 4 rules; 2 standing adjustments, still the seeded "partner 1" and "partner 2" at €600 each. The planned amounts come to about 71/20/9 once the allowance line is gone. Both services were running; the bot's log showed one failed poll and nothing else.

**Bot test.** The real app and bot (`backend/telegram_bot.py`, commit 1318268, the deployed release) with the real Claude, on a copy of the production data and a stand-in for Telegram. The copy was deleted afterwards.
- Worked: questions in English and Dutch (6 to 10 seconds), a cash payment in words, a bare "albert heijn 23,40", Apply, typed yes, undo, two messages at once, Stop, and reviewing guesses.
- Failed or awkward:
  - a second account and a group chat get silence (`telegram_bot.py:248`);
  - a voice note, and a photo with a caption, both get "Send an ING CSV as a file" (`telegram_bot.py:401`);
  - an ING export with Dutch column names is rejected (`backend/importers/ing.py:14`);
  - a Revolut file is rejected in chat;
  - a 233-row card arrived as six messages of one line per payment plus 37 budget lines (`telegram_bot.py:167`);
  - each reply is three messages: log, card, explanation.
- In that test Claude called about 240 of the 400 waiting guesses sure. The doubtful ones were transfers between people and accounts, convenience stores, and refunds.

**Code audit** (delegated, read-only):
- Standing adjustments write two confirmed manual rows per month on the first GET of a month (`backend/adjustments.py`). Edits skip months already written, and other code special-cases them (`routers/recurring.py:157`, `import_service.py:78`, `BudgetPlanner.tsx:55`).
- A new month copies the default budget rows, and the screens edit only the month row, so plan changes do not carry forward (`backend/routers/budget.py:15`).
- Recurring payments are derived on each call and need three payments (`backend/routers/recurring.py:36`); they are not subtracted from "left".
- The Import link shows only when the month has no bank data (`frontend/src/pages/Month.tsx:193`).
- The "Counts as" picker fails for categories in use (`backend/routers/categories.py:112`).
- Rule priority is always sent as 0.
- There are no pytest tests for the bot or the assistant; they are covered by the Playwright specs in `frontend/e2e/`, which include a Telegram stand-in.

**Budgeting tools** (delegated web research; details and links in the session, not re-verified here):
- Monarch's flex budgeting gives one number: income minus fixed, non-monthly and goals. It also turns a non-monthly bill into a monthly set-aside. https://www.monarch.com/blog/flex-budgeting-simplify-your-spending-with-just-one-number
- YNAB's method: https://www.ynab.com/ynab-method
- Users most often report quitting over a categorisation backlog, broken sync, and losing trust in the numbers. No solid study of budgeting-app abandonment was found.
- Reminders that name something specific worked better than generic ones (Karlan et al. 2016).
- Open banking: GoCardless Bank Account Data is closed to new signups. Enable Banking allows personal use and lists ING for the Netherlands; Revolut for Dutch personal accounts was not confirmed, and consent has to be renewed every 90 to 180 days. https://enablebanking.com/docs/markets/nl/

## Optional wishes and open points

Not part of the agreed scope:
- Automatic bank import through Enable Banking, as a later feature.
- A DEGIRO importer, possibly later.
- Folding savings goals and set-asides into one idea.

To be found out during the build; the requirements do not depend on a particular answer:
- Whether the sandboxed Claude can be handed pictures without weakening the sandbox (R-005).
- How well speech recognition run on the server handles Dutch (R-004). The server has 16 cores and 31 GB of memory.
- How "sure" is measured for a guess (R-011); the payment's stored confidence is one candidate.
- How fixed monthly bills are recognised for R-017, given that today's detection needs three payments.
- Telegram only shows a bot every group message when its privacy mode is off; this is a setup step for R-001.
