# Requirements: Finance chat assistant

Approved 2026-11-09. Context and rejected alternatives: [brainstorm.md](brainstorm.md).

"Chat" means both the Telegram finance bot and the in-app bubble. A requirement applies to both unless it names one.

## Channels and access

### R-001 — Own Telegram chat
Budgeting on Telegram runs in its own bot, separate from Arnold.

**Acceptance:** Finance messages sent to the bot get finance replies there. Nothing from that chat appears in Arnold's chat or in the Brain coaching logs.

### R-002 — Telegram is only for Daniel
Only Daniel's Telegram account can use the Telegram bot.

**Acceptance:** A message or file from any other Telegram account changes nothing and reveals no finance data.

### R-024 — Bubble access
Anyone signed in to the app can use the bubble.

**Acceptance:** The bubble needs no sign-in beyond the app's own. Its wording does not assume which of the two household members is looking.

### R-016 — One assistant
The bubble and Telegram behave the same.

**Acceptance:** The same message against the same data leads to the same proposed change in either chat. A change made in one chat shows up in the app and is reflected by the other.

### R-017 — Claude subscription
The assistant runs on the existing Claude login.

**Acceptance:** Both chats work with no Anthropic API key and no extra billing. Telegram does not use Hermes or OpenAI to understand or answer finance messages.

### R-018 — AI only proposes
The AI can suggest changes but cannot make them itself.

**Acceptance:** The AI has no access to files or commands. Text inside a bank description or other stored data cannot cause a change without a person's Yes.

## Importing ING files

### R-003 — Drop to import
Sending an ING CSV imports it with no further step.

**Acceptance:** New rows appear in the app without a confirmation. Sending the same file again adds nothing.

### R-004 — Same sorting
Chat imports are sorted the same way as app imports.

**Acceptance:** Rows matching a rule are auto-confirmed. Claude's guesses wait in Review for a person.

### R-005 — Import summary
Each import ends with one summary.

**Acceptance:** The summary gives counts for new rows, duplicates skipped, sorted by rules, guesses awaiting review, and uncategorised. The chat does not start reviewing by itself.

### R-006 — Bad files
A file that cannot be read as an ING CSV is refused.

**Acceptance:** The chat says the file could not be used and nothing is imported, including when zero rows are found.

### R-025 — Files in the bubble
ING files can be attached in the bubble with a paperclip, or dragged onto the panel on a computer.

**Acceptance:** Either way follows R-003 to R-006. A waiting message shows while the file is being read and sorted.

### R-026 — Summary card
The bubble shows import results on one card with one count per row.

**Acceptance:** Each count from R-005 has its own row. Any double entries from R-012 follow in their own card with Merge and Keep both.

## Making changes by text

### R-007 — Change by text
Plain text can change anything the app can.

**Acceptance:** This covers transactions (refund, recategorise, split, add, edit, delete), budgets, rules, categories, standing adjustments and settings. Applied changes show in the app.

### R-008 — Confirm first
No change is made without an explicit Yes.

**Acceptance:** The chat shows the exact change first. No, or no answer, changes nothing. A double tap on Yes applies the change once.

### R-009 — Ask, don't guess
When a message could mean several things, the chat asks.

**Acceptance:** When two transactions could match, the chat shows both and asks which one, and proposes no change until answered.

### R-010 — Refunds
A described refund is booked against the original purchase's category.

**Acceptance:** After Yes, the incoming payment counts as a refund and lowers that category's spend in the month the money arrived. It does not count as income, and the purchase's month is unchanged.

### R-011 — Not imported yet
If the payment is not in the app, the chat offers to add it manually.

**Acceptance:** The chat says it could not find the payment and proposes a manual entry. After Yes, the budget updates straight away.

### R-012 — Merge copies
After an import, likely double entries are flagged for one-tap merging.

**Acceptance:** The import result lists manual entries that look like a new bank row (same amount, close date). Yes removes the manual copy and carries its category and refund mark to the bank row, so it counts once. No keeps both. Nothing merges without a Yes.

### R-013 — Questions
The chat answers budget questions without changing anything.

**Acceptance:** "How are we doing this month?" matches the app's figures for the current financial month and needs no confirmation.

### R-014 — Review on request
The chat clears Claude's guesses when told to.

**Acceptance:** The chat shows which guesses are affected, and one Yes confirms them. It never reviews unprompted.

### R-015 — Honest failures
The chat never reports success for something that failed.

**Acceptance:** If the app is unavailable, rejects a change, or Claude is logged out or at its usage limit, the chat says why and the data is unchanged.

### R-022 — Field-by-field confirmation
A proposed change lists each changed field before and after, plus its budget effect.

**Acceptance:** The bubble shows a card with the changed fields, the purchase a refund belongs to, the category's new total, and Apply and Not this. Telegram gives the same details as text with a way to say yes or no.

### R-023 — Result states
An applied or failed change replaces the card with a clear result.

**Acceptance:** Applied says what changed and the new total. Failed says nothing changed and offers Try again.

## The bubble

### R-019 — Open button
A round clay button opens the chat on every page.

**Acceptance:** The button is 56px, at the bottom right, and sits above the phone tab bar without touching it. It is not vermilion. The last row of any page can be scrolled clear of it.

### R-020 — Computer panel
On a computer the chat is a right-hand panel beside a usable page.

**Acceptance:** The page moves over and is not dimmed. After Apply, the figures on the page update without a reload.

### R-021 — Phone sheet
On a phone the chat opens as a bottom sheet.

**Acceptance:** The sheet sits over the tab bar and closes with Close. Nothing runs off the side at 390px.

### R-027 — First open
An empty chat says what it can do and offers three starters.

**Acceptance:** One line explains the chat and that nothing changes until confirmed. One starter reflects what is waiting, such as "Go through the 3 to review". If nothing is waiting, that starter is not shown.

### R-028 — Saved conversation
The bubble keeps one saved conversation, separate from Telegram's.

**Acceptance:** The conversation is still there after a reload. A Clear option empties it after confirmation. Both household members see the same history.

### R-029 — Busy
A message sent while Claude is busy waits visibly.

**Acceptance:** The chat shows it is waiting, then answers. The message is not lost.

### R-030 — Look and fit
The bubble matches the app's clay design.

**Acceptance:** The bubble uses the app's existing design tokens and works in day and night themes. Every bubble control is at least 44px tall on a phone.

## Deferred

- **D-001 — Partner access on Telegram.** Daniel wants to share the Telegram bot later. What sharing looks like, and who may change what, is undecided. R-002 stands until then.

## Retired

None.

## Change history

- 2026-11-09: First approved version, R-001 to R-030.
