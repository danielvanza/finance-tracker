# Household Finance

[![CI](https://github.com/danielvanza/finance-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/danielvanza/finance-tracker/actions/workflows/ci.yml)

A private budget for a two-person household. It reads ING exports, sorts the payments with rules and Claude, and answers one question: what is free to spend until payday? Both people use it, in the web app and through a Telegram bot in a group they share.

## What it does

- **Import.** An ING export (CSV, English or Dutch column names) from the Import page or dropped into Telegram. Rows already in are skipped, whichever language the earlier file was in.
- **Sorting.** Rules first: a description containing a rule's text gets its category, and when several fit the longest text wins. A text shorter than six characters only fits as a word of its own, so "esso" does not sort "Espresso Bar". Then Claude. A guess Claude is sure of counts at once and is marked "auto". A doubtful one waits, counts nowhere, and is put to the household as a question with buttons in Telegram; it is also in the review list on Transactions.
- **Remembering.** When a person says where a shop belongs, that becomes a rule. The shop's other waiting payments follow at once and later ones are sorted without a question. A payment through a service that hides the shop (Tikkie, PayPal) is asked about each time and never becomes a rule.
- **Month.** The headline is "free to spend until payday": what is left in the plan, less the fixed bills still to come this month, less what this month sets aside. Underneath: the pace line, needs, wants and savings against the plan and against the household's own target split, and every category.
- **Set-asides.** A yearly or irregular bill is entered once (name, amount, due month). An equal share is set aside each month until it is due. The payment that settles it is marked and comes out of what was set aside; only the part not set aside yet counts as spending.
- **Plan.** A planned amount changed in a month stays for the months after it. Earlier months keep theirs.
- **Chat.** The same assistant in a panel in the app and in Telegram. It answers from the app's own figures and proposes changes as cards; nothing changes without Apply.
- **Telegram.** Text, voice notes (English), photos of a receipt or a banking screen, and ING files. It also writes first: when the bank data is over a week old, a recap on Sunday evening, and how the month ended on the first day of the next. Never between 21:00 and 9:00, and whatever is owed at one moment arrives as one message.

Money moved from the shared account to one of the household's own names is sorted into "To personal accounts" and counts as spending. The names are entered once in Setup, as the bank shows them.

## Architecture

```
frontend/              React 19 + TypeScript + Vite
  src/pages/           Month, Transactions, Trends, Setup, Import
  src/components/      shared parts: review card, set-asides, target split, recurring payments, reports
  src/chat/            the chat panel and its cards
  e2e/                 Playwright specs: the real app, bot and browser

backend/               FastAPI + SQLAlchemy + SQLite
  routers/             imports, transactions, budget, set_asides, rules, dashboard, categories, recurring, goals, settings, chat
  importers/ing.py     the ING parser (English and Dutch)
  categorizer/         rules, Claude (sure or doubtful), and the sandboxed Claude login
  guesses.py           which guesses count, the questions about the rest, and what an answer teaches
  set_asides.py        the sums behind set-asides
  nudges.py            what the bot says unasked
  voice.py             voice notes to text, on this machine
  assistant/           the chat agent: its tools, what it can change, the conversation
  telegram_bot.py      the Telegram bot, a process of its own
```

**Database:** SQLite at `backend/data/finance.db` (override with `DATABASE_URL`). Alembic migrations in `backend/alembic/` run on startup. A database from before Alembic must be registered once with `cd backend && .venv/bin/alembic stamp afe0635828ba`; the next start brings it up to date.

## Quick start

```bash
./dev.sh          # installs what is missing, then runs backend (8000) and frontend (5173)
./dev.sh setup    # only install
```

Open http://localhost:5173. Or by hand:

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && uvicorn main:app --reload
cd frontend && npm install && npm run dev
```

Needs Python 3.11+ and Node 20+.

## Claude

Sorting and the chat use Claude in one of two ways:

- **The machine's Claude login** (`CLAUDE_CLI_HOME` set): `claude -p` in a bubblewrap sandbox with no built-in tools, no settings and an empty `/home` (`categorizer/claude_cli.py`). The chat only works this way. Needs `bwrap` and the `claude` CLI.
- **An API key** (`ANTHROPIC_API_KEY`): for sorting imports only.

With neither, rules still sort and everything else waits in the review list.

## Environment

| Variable | Default | What it is |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/finance.db` | Where the database is. |
| `ANTHROPIC_API_KEY` | none | Claude for sorting imports, when the login below is not used. |
| `CLAUDE_CLI_HOME` | none | Private folder for the sandboxed Claude login. Turns the chat on. |
| `CHAT_MODEL` | `sonnet` | The model behind both chats. |
| `SORT_MODEL` | `sonnet` | The model that sorts imported rows, on the Claude login. |
| `CHAT_TIME_LIMIT_SECONDS` | `540` | How long one reply may take. |
| `AI_TIME_BUDGET_SECONDS` | `60` | How long sorting one import may take; the rest waits for next time. |
| `VOICE_MODEL` | `small.en` | The speech model for voice notes. Fetched once, on the first voice note. |
| `FINANCE_TIMEZONE` | `Europe/Amsterdam` | The household's time, for dates and for when the bot may write. |
| `NUDGES` | `on` | `off` stops the bot writing unasked. |
| `TELEGRAM_BOT_TOKEN` | none | From BotFather. |
| `TELEGRAM_ALLOWED_USER_IDS` | none | The two numeric Telegram accounts, comma-separated. |
| `TELEGRAM_GROUP_ID` | none | The numeric id of the household's group. |
| `FINANCE_API_URL` | `http://127.0.0.1:18600/api` | Where the bot finds the app. |

## Deployment

The app has no sign-in of its own, so it runs on loopback behind something that signs people in. Here that is the life dashboard, which serves it at `/finances`.

- `deploy/deploy.sh` builds this checkout's HEAD into `~/apps/household-finance/releases/<sha>` and switches the `household-finance` systemd user unit to it, rolling back if `/api/health` does not answer.
- `deploy/household-finance.service` runs `backend/serve.py` (API under `/api`, built UI at `/`) on `127.0.0.1:18600`. The database lives outside the releases, at `~/.local/share/household-finance/finance.db`.
- `deploy/household-finance-telegram.service` runs the bot. It reads `~/.config/household-finance/telegram.env` (mode 600).

### Setting up the Telegram group

1. In BotFather, turn the bot's group privacy **off** (`/setprivacy`, Disable). Otherwise Telegram hands a bot in a group only commands.
2. Make a group with the two of you and add the bot.
3. Put both numeric account ids in `TELEGRAM_ALLOWED_USER_IDS`, comma-separated, and restart the bot. With no `TELEGRAM_GROUP_ID` it answers nobody.
4. Write anything in the group. The bot's log (`journalctl --user -u household-finance-telegram`) then names the group's id. Put it in `TELEGRAM_GROUP_ID` and restart.

From then on the bot works in that group only. Any other account or group gets silence, and a private message from one of you gets one line pointing to the group.

## Testing

```bash
cd backend && pytest                                   # unit tests, in-memory SQLite
cd frontend && npx vitest run                          # component tests
cd frontend && npm run build && npx playwright test    # end to end: real app, bot and browser
```

The end-to-end specs start their own app, bot and a stand-in for Telegram on throwaway databases. The `*-controlled` specs script Claude; the `*-real` specs use the machine's Claude login on synthetic data.
