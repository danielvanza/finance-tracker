# Household Finance: using it

How to run it is in [README.md](README.md). This is how the household uses it.

## The routine

1. Export from ING: the shared account, as a CSV file, from the last date the app has to today. The Import link on Month and Transactions says how far the bank data runs.
2. Send the file to the bot in the Telegram group, or drop it on the Import page. Rows already in are skipped.
3. Answer the questions the bot asks. Each is about one shop or person, with buttons for the likely categories. The answer is remembered, so the same shop is not asked about again. Payments through Tikkie or PayPal are the exception: they are different every time, so each is asked about.
4. Look at Month, or ask the bot how you are doing.

Nothing else is needed week to week. The bot says so when the bank data is more than a week old.

## What counts and what waits

| A payment is | It counts | How it shows |
|---|---|---|
| sorted by a rule | at once | |
| a guess Claude is sure of | at once | tagged "auto" in Transactions |
| a guess Claude is not sure of | once someone answers | in the questions and the review list |
| paid from a set-aside | in no month | tagged "set aside" |

A payment that waits is in no total. Month says how many are waiting in the current month.

An automatic sorting can be changed at any time, in Transactions or by telling the bot. A correction is remembered for the shop.

## Free to spend

The Month headline is what can still be spent freely until payday:

- what is left in the plan for needs and wants,
- less the fixed bills that have not been debited yet this month,
- less what this month sets aside.

A fixed bill is a payment the bank data shows coming back on a regular day, at least three times. The line under the headline opens the list. "Not a fixed bill" takes one out; the Recurring payments sheet can count it again.

## Set-asides

In Setup. For a bill that does not come every month: enter its name, amount, the month it is next due and how often it comes (every 3 months, every 6 months, every year, or once). From this month to that one, an equal share is set aside each month. A bill that comes back then starts again over its own number of months: three for car tax each quarter, twelve for a yearly bill.

When the bill is paid, press "Mark as paid" on the set-aside and choose the payment. It then comes out of what was set aside and does not count against the month. If the bill came before it was set aside for in full, the part that was missing counts as spending in that month.

## The plan

Setup holds the budget for the current month. A planned amount can also be changed on Month, by opening a category. A change applies from that month on; earlier months keep what they had.

The target split, also in Setup, is how you aim to divide income between needs, wants and savings. It starts at 50/30/20. The three numbers must add up to 100.

What a category counts as (needs, wants, savings, income, or left out of the totals) is changed in Setup, under Categories.

## The Telegram bot

It works in the group the two of you share with it. Either of you can ask, and either can press the buttons on a card the other asked for.

| Send | What happens |
|---|---|
| a question in words | an answer from the app's own figures |
| "paid 15 cash at the market" | a card to add it; Apply makes it happen |
| a voice note, in English | the same as typing it; the reply shows what was heard |
| a photo of a receipt or a banking screen | a card with the shop, amount and date it read |
| an ING export | the import, then questions about what Claude was not sure of |
| `stop` | ends the reply being worked on |
| `/new` | starts the conversation afresh |

A card says what will change in a line or two. A large batch is summed up per category; "Show all" lists every row. Typing yes or no answers the card in front of you.

The bot writes first in three cases, never between 21:00 and 9:00, and in one message when several are due at once:

- the newest bank payment is more than a week old;
- Sunday evening: what is free to spend, and what stood out;
- the first morning of a financial month: how the last one ended.

## Money you move to your own accounts

The app covers the shared account only. Money moved from it to one of your own names is sorted into "To personal accounts", counts as spending, and can be given a planned amount. Enter your names once in Setup, under "Your own accounts", as the bank shows them on a transfer; any spelling around them ("Hr", "via bunq") still matches.

## Refunds and splits

Money that came back from a shop is a refund: it lowers the category of what was bought. The bot's question for incoming money offers this as "Refund: <category>". A payment can also be split over several categories, in Transactions.

## Data

Setup offers every transaction as a CSV file. The database file on the server is the backup.
