# Requirements: finance agent

Feature folder: `thoughts/features/2026-11-10-finance-agent/`. Decision context is in `brainstorm.md`.

This feature turns the finance chat into a conversational agent. It builds on `2026-11-09-finance-chat-assistant` and `2026-11-09-chat-insights`, and replaces the requirements listed under "Replaces" below.

## Active requirements

### R-001 — One ongoing conversation per chat
Telegram and the web panel each keep one conversation that the agent remembers in full, until someone starts a new one.

**Acceptance:** Something said near the start of a long conversation is still understood many messages later without repeating it. "New chat" in the panel, or /new in Telegram, starts fresh, and the agent no longer draws on the earlier conversation. The Telegram and panel conversations stay separate.

### R-002 — Free, finance-focused replies
Replies are ordinary conversation, with no fixed layouts or added lines, and stay on household money.

**Acceptance:** "How are we doing this month?" gets a natural answer with the current figures. A follow-up such as "and groceries?" carries on from it. An unrelated request gets a short note that the agent helps with household finances.

### R-003 — Look anything up
The agent can look up anything in the household's finances, for any month, as often as a reply needs, without changing anything.

**Acceptance:** A question that needs several lookups is answered in one reply. No lookup changes any data.

### R-004 — Honest figures
Figures come from the agent's lookups. When data is missing, a lookup fails or something cannot be found, it says so instead of guessing.

**Acceptance:** A question about a month with no data says there is none. A failed lookup gives a plain sentence and no made-up number. Totals the agent gives match the Month page.

### R-005 — Change anything, through a card
Everything the app can change, including savings goals, can be asked for in conversation. Each change appears as a card and happens only after Apply.

**Acceptance:** Asking to change a payment, a budget, a rule or a savings goal produces a card. Not this, or no answer, changes nothing. A double tap applies the change once. A typed yes or no to the card in front of it still works.

### R-006 — Batch cards
One card can hold a large batch of changes and stays readable in both chats.

**Acceptance:** One card can confirm 85 guesses. In Telegram a long card is split over messages, with the buttons on the last one. Apply changes all 85 at once.

### R-007 — The agent fixes its own cards
When the app rejects part of a suggested change, the agent is told why and corrects it, instead of the person getting an error.

**Acceptance:** A batch that wrongly includes a row that is not a guess becomes a card without that row, or a question about it. The person only sees a plain explanation when the change truly cannot be made.

### R-008 — Review guesses together
"Let's go through the guesses" walks through every waiting guess in groups the agent chooses, card by card.

**Acceptance:** With 420 waiting guesses, the conversation reaches zero waiting guesses without opening the app's pages. A correction such as "those are Eating out" becomes an adjusted card. After each group the agent says how many guesses are left.

### R-009 — Step-by-step log
While the agent works, each step it takes shows live, in plain words, in both chats.

**Acceptance:** Each lookup or action appears within a few seconds of starting. In Telegram the log is one message that keeps updating. No query text appears in the log.

### R-010 — Stop
A Stop button in both chats, or typing stop or /stop in Telegram, ends the current reply.

**Acceptance:** The reply stops within a few seconds and nothing changes. The agent says what it had found so far. Cards from earlier stay as they were.

*Agreed reading (2026-11-11):* "stops within a few seconds" means the work ends and the chat shows it has stopped within a few seconds (the log shows "Stopping…" at once and no further lookup runs). The agent's write-up of what it had found may follow some seconds later (about 10–15 s with the real Claude).

### R-011 — Up to about 10 minutes
One reply takes at most about 10 minutes.

**Acceptance:** At the limit the agent gives what it has and says it stopped early. Messages sent meanwhile wait, with the existing "waiting" note.

### R-012 — Same safety as today
The agent runs on the household's Claude login with no API key, has no files, shell or internet, and uses only the app's own tools.

**Acceptance:** Text hidden in bank descriptions or other stored data cannot cause a change without Apply. Attempts to read files or run commands fail.

### R-013 — Charts when they help
The agent can show a chart, drawn by the app from its lookups, in both chats.

**Acceptance:** "Show spend per category over 6 months" delivers a picture in both chats whose numbers match the answer.

### R-014 — What works stays
Sending ING files, the import summary, merge offers, Telegram answering only its one account, and not assuming who is writing all work as they do now.

**Acceptance:** The existing checks for these behaviours still pass.

## Replaces

Superseded by this feature, by decision on 2026-11-10:
- `2026-11-09-chat-insights` R-006 (3-minute effort limit): replaced by R-011.
- `2026-11-09-chat-insights` R-007 (progress note): replaced by R-009.
- `2026-11-09-chat-insights` R-008 ("Based on" line): retired; replies are free (R-002).
- `2026-11-09-chat-insights` R-009 (refusing typed figures): replaced by R-004, which rests on the agent's instructions rather than a check on its wording.
- `2026-11-09-chat-insights` R-010 (pattern questions never create a card): retired; any change the person asks for gets a card (R-005).
- `2026-11-09-finance-chat-assistant` R-013, as far as the fixed "how are we doing" layout goes; matching the app's figures continues in R-004.
- `2026-11-09-finance-chat-assistant` R-014 (one card for the guesses): replaced by R-006 and R-008.
- `2026-11-09-finance-chat-assistant` R-028, as far as Clear goes: replaced by New chat in R-001. The saved, shared conversation stays.

## Deferred and retired

None yet.

## Change history

- 2026-11-10: R-001 to R-014 agreed and locked.
