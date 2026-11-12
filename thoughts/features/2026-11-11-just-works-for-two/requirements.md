# Requirements: just works for two

Feature folder: `thoughts/features/2026-11-11-just-works-for-two/`. Decision context is in `brainstorm.md`.

This feature makes Household Finance usable by both members of the household with almost no upkeep. It builds on `2026-11-10-finance-agent` and replaces the requirements listed under "Replaces" below.

Defaults agreed with the requirements: the group is the only Telegram conversation; the weekly recap goes out on Sunday around 18:00; bank data is "old" when its newest payment is more than 7 days back; the bot replies in text, never in voice; savings goals are unchanged; the "DEGIRO" savings category stays (only the DEGIRO file importer goes).

## Active requirements

### Telegram

### R-001 — One group for the bot and both people
The bot works in one Telegram group with the two members of the household.

**Acceptance:** A message from either person in the group is answered. A card made in answer to one person can be applied or rejected by the other. Any other account, and any other group, gets silence. A private message from either person gets one line pointing to the group and nothing else.

### R-002 — Short replies
A reply takes up as little of the chat as it can.

**Acceptance:** A simple answer, and a simple card with its explanation, each arrive as one message. The step-by-step log shows while the bot is working and is gone once the reply is there.

### R-003 — Plain cards
A card says what will change in ordinary words, in both chats.

**Acceptance:** A simple change, such as adding one payment, reads as one or two lines with no field-by-field list. A batch is summarised per shop or category with counts and totals, and fits in one Telegram message whatever its size. Asking to see everything lists the rows. Apply and Not this work as before.

### R-004 — Voice notes
A voice note in English is understood like a typed message.

**Acceptance:** Saying "fifteen euros cash at the market" gives the same card as typing it. The reply shows what was heard. A note that cannot be understood gets a request to repeat it or type it, and nothing changes. Replies are text.

*Changed 2026-11-11:* Dutch voice notes dropped at Daniel's request ("We don't need to cover Dutch"). Dutch ING exports (R-006) stay.

### R-005 — Photos
A photo of a receipt or a banking screen is read.

**Acceptance:** A readable photo gives a proposed payment with shop, amount and date. A caption on a photo is treated as the person's message. A photo that cannot be read is said to be unreadable. Nothing changes without Apply.

### R-006 — ING files in either language
ING exports with Dutch or English column names both import.

**Acceptance:** Both kinds import in Telegram and on the Import page, with the same result for the same payments. Any other file gets one sentence saying what is accepted, and nothing is imported.

### R-007 — Old-data nudge
The bot says when the bank data has fallen behind.

**Acceptance:** When the newest bank payment is more than 7 days old, the group gets one message saying how far the data runs and asking for a new export. It is not repeated until another 7 days have passed or a file has been imported.

### R-008 — Weekly recap
The bot sends a short recap every week.

**Acceptance:** On Sunday evening the group gets one message of at most six lines: what is free to spend, the per-day figure, and one or two things that stood out. Its figures match the Month page. When the data is old it says so and gives no figures that would mislead.

### R-009 — Payday month close
The bot reports how the month ended when a new financial month starts.

**Acceptance:** On the first day of a financial month the group gets three or four lines on how the month that just ended compared with the plan. When that month's data is incomplete it says so.

### R-010 — Quiet nudges
Messages the bot sends unasked never become a nuisance.

**Acceptance:** Nothing is sent unasked between 21:00 and 9:00, also when a message made earlier could only be delivered at night. After the app has been down, a missed message is sent once, never several in a row: everything owed at that moment arrives as one message.

*Clarified 2026-11-12, with Daniel:* "never several in a row" means one combined message when a recap, a month close and an old-data nudge are owed together.

*Clarified 2026-11-12, after the second review, with Daniel:* the same holds when the app kept running but the bot could not deliver (it was off, or had no group yet): what waited is replaced by one message that says everything as of the moment it is sent.

### Guesses

### R-011 — Sure guesses count straight away
A payment Claude is sure about counts without anyone confirming it.

**Acceptance:** After an import, sure guesses are in the totals at once. They are marked as sorted automatically and can still be changed by a person. Doubtful guesses do not count and wait for an answer.

### R-012 — Doubtful guesses become short questions
A payment Claude is not sure about is put to the household as a question.

**Acceptance:** After an import the group gets questions grouped per shop or person, each with buttons for the likely categories. The same payments are in the app's review list. They count nowhere until answered.

### R-013 — Answers can be remembered
Once a person has confirmed or corrected a shop, they can have it remembered, so it is not asked about again.

**Acceptance:** The answer sorts that shop's other waiting payments at once. Nothing is remembered by itself: after an answer in the group and after an applied card, one button offers to remember the shop or shops, and the review card in the app has a tick box for it. Once remembered, every later payment from that shop is sorted the same way with no question.

*Changed 2026-11-12, with Daniel:* remembering was automatic ("every later payment from that shop is sorted the same way"). One answer for a person or for a holiday's shops made rules nobody wanted, so it is now offered after the answer.

### R-014 — The existing pile is cleared the same way
The payments already waiting are handled by R-011 to R-013 without importing them again.

**Acceptance:** After release, the sure guesses among those waiting count, and the rest arrive as grouped questions. The number waiting can reach zero from Telegram alone.

### Budget

### R-015 — Shared account only
The budget covers the imported account; invented payments are gone.

**Acceptance:** Standing adjustments and adjustment pairs are gone from Setup, from Add transaction and from what the chat can change. The invented allowance payments already in the data are removed. No total changes except by the amount of those payments.

### R-016 — "To personal accounts" category
Money moved from the shared account to either person's own account has a category of its own.

**Acceptance:** Such a transfer is sorted into it automatically, counts as spending, lowers what is free to spend, and the category can be given a planned amount like any other.

*Clarified 2026-11-12, with Daniel:* the household enters its own names once in Setup, as the bank shows them. A transfer whose name contains one of them is sorted automatically from the first time.

*Changed 2026-11-12, after the second review, with Daniel:* only names entered in Setup count. The sentence "A name that has paid in as income in two months is recognised without being entered" is dropped: it also took the tax office paying an allowance for one of the household, and booked tax payments as money moved to a personal account.

### R-017 — "Free to spend until payday" is the headline
The Month page and the bot lead with what can still be spent freely.

**Acceptance:** Both show the same figure: what is left in the plan, minus the fixed monthly bills not yet debited this month, minus this month's set-asides, with a per-day figure. The bills counted are listed. A person can mark a listed payment as not a fixed bill, and it is then left out.

### R-018 — Set-asides for yearly and irregular bills
A bill that does not come monthly is spread over the months before it is due.

**Acceptance:** A bill is entered once with a name, an amount and the month it is due. Its monthly share lowers what is free to spend. When the bill is paid it comes out of what was set aside and does not count against that month's pace.

### R-019 — The household's own target split
Needs, wants and savings are measured against percentages the household sets.

**Acceptance:** Setup holds three percentages that must add up to 100, starting at 50/30/20. The Month page and the budget planner compare needs, wants and savings with them.

### R-020 — Plan changes carry forward
A changed planned amount stays changed.

**Acceptance:** A new planned amount for a category applies to the month it was set in and every later month until changed again. Earlier months keep the amounts they had.

*Clarified 2026-11-12, after the second review, with Daniel:* "until changed again" also holds when an earlier month is changed afterwards. Example: November was set to €400 by hand, then September is changed from €350 to €300. October follows to €300; November and later keep €400.

### R-021 — Import is always reachable
There is always a visible way to import.

**Acceptance:** The Month and Transactions pages always show a link to Import, with the date the bank data runs to.

### Clean-up

### R-022 — ING only
The app takes ING files and nothing else.

**Acceptance:** The Revolut and DEGIRO importers are gone, and so is every mention of them as a source in the app, the bot's messages and the documents. The "DEGIRO" savings category and its payments are untouched.

### R-023 — No rule priority
Rules have no priority number.

**Acceptance:** When several rules match, the most specific one wins. Rules that do not overlap sort payments the same way as before.

*Changed 2026-11-12, with Daniel:* the second sentence read "Payments already sorted by today's rules would be sorted the same way", which cannot hold for two overlapping rules once the most specific one wins. The household's own rules do not overlap (checked on 2026-11-12).

*Changed 2026-11-12, after the second review, with Daniel:* a rule text shorter than six characters only fits as a word of its own, so "esso" no longer also sorts "Espresso Bar". Such a rule sorts the payments that name the shop as before; it stops sorting payments that only contained its letters inside another word.

### R-024 — No "Refunds" income category
Refunds are booked one way only: as a refund against the original category.

**Acceptance:** The "Refunds" income category is gone. Payments that were in it go back to the questions, to be booked as refunds.

### R-025 — No "Counts as" picker on Month
A category's type is changed in Setup only.

**Acceptance:** The Month page no longer offers it. Setup still does.

### R-026 — No JSON backup
The JSON backup download is removed.

**Acceptance:** Setup no longer offers it. The CSV export still works.

### R-027 — Unused code and stale documents
What is not used is removed, and the documents describe the app as it is.

**Acceptance:** README, SETUP and AGENTS match the app after this feature. Removing unused parts changes nothing a person can see.

### R-028 — What works stays
Everything not changed above behaves as it does now.

**Acceptance:** Asking questions, Apply and Not this, typed yes and no, Stop, charts, New chat and the web chat panel work as before. The existing checks for them still pass, apart from those that cover behaviour replaced here.

## Replaces

Superseded by this feature, by decision on 2026-11-11:
- `2026-11-10-finance-agent` R-006, as far as a long card being split over several Telegram messages goes: replaced by R-003. One card can still hold a large batch.
- `2026-11-10-finance-agent` R-014, as far as Telegram answering only its one account goes: replaced by R-001.
- `2026-11-10-finance-agent` R-008, as far as every guess waiting for a person goes: replaced by R-011 to R-014. Reviewing together in conversation stays available.
- `2026-11-09-finance-chat-assistant`, field-by-field confirmation on cards: replaced by R-003.
- The product principle "people confirm, machines sort" (`PRODUCT.md`) now applies to doubtful guesses only (R-011, R-012).

## Deferred and retired

- **Automatic bank import** (for example ING through Enable Banking): deferred by decision on 2026-11-11. Not part of this feature.
- **A DEGIRO importer:** removed by R-022; may come back later as its own feature.

## Change history

- 2026-11-11: R-001 to R-028 agreed and locked.
- 2026-11-11: R-004 narrowed to English voice notes, by Daniel during the build. R-006 (Dutch ING exports) confirmed unchanged.
- 2026-11-12: R-013 changed, with Daniel: a shop is remembered only when asked, through a button after an answer or an applied card, or the tick box on the review card.
- 2026-11-12: after the second independent review, with Daniel: R-010 clarified (one message also when only the bot could not deliver), R-016 changed (names from Setup only), R-020 clarified (a later month changed by hand keeps its amount), R-023 changed (a short rule text fits whole words only).
- 2026-11-12: after the first independent review, with Daniel: R-010 clarified (one combined message after downtime; quiet hours hold at delivery), R-016 clarified (own names entered in Setup), R-023 second sentence reworded to rules that do not overlap. A typed yes in the group keeps applying the one open card, by Daniel's choice.
