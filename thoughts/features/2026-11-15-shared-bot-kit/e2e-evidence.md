# Shared bot kit — E2E evidence

Executed 2026-11-15/16; delivered 2026-11-16 (see "Delivered" at the end). Raw logs, scripts and screenshots: `~/artifacts/shared-bot-kit-e2e/` (below: `A/`).

## Where the work is

| Repo | Location | State |
|---|---|---|
| bot-kit (new) | `~/code/bot-kit` (`SPEC.md`, `python/`, `ts/`, `docs/parity.md`) | first local commit `5f19289` (2026-11-16), not pushed |
| household-finance | worktree `~/code/hf-bot-kit`, branch `feat/shared-bot-kit` | uncommitted |
| life-dashboard | worktree `~/code/ld-bot-kit`, branch `bot-kit` | uncommitted |
| roadmap-studio | worktree `~/code/rs-bot-kit`, branch `feat/shared-bot-kit` | uncommitted |

Environments: each app's own fixture/E2E setup on synthetic or fixture data and scratch databases. That means finance's Playwright fixtures, LifeSystem's `tests.e2e_server` (fixture app, fake calendar, fixture Brain vault) and Studio's Playwright harness with a scratch `STUDIO_DATA`. No live app, database, calendar or Telegram was used. The scripted runner is the kit's `script` test runner (SPEC §12): only the model is fake, and the real tools run. Real runners use this machine's Claude Code and Codex logins and an Anthropic API key in the server's environment only. There is no OpenAI API key.

## Per requirement

**R-001 One spec, two packages.** `SPEC.md` governs both packages. A single scenario driver (`bot-kit/e2e/parity.py`, moved into the repo after the first review) runs the same sequence over HTTP against the Python demo and the TypeScript demo and diffs the normalised JSON. The sequence covers ask, tool lookup, card, Apply ×2, a stale card, an immediate change with Undo, Stop, time limit, New chat, starters, picker, failure, typed yes/no, uploads, outbox and restart recovery. Result: `IDENTICAL: 181 recorded responses, no differences` (`A/parity.log`, rerun after the last kit changes). The same flow (ask, lookup, card, Apply, Undo, Stop, New chat) also passes in the Python apps (finance `bubble-real`/`chat-controlled`, LifeSystem `A/ld/e2e.py`) and in Studio (`tests/bot-assistant.spec.ts`).

**R-002 Four runners.**

| App | claude-cli | claude-api | codex-cli | openai-api |
|---|---|---|---|---|
| finance | correct (€126,10 at Albert Heijn in Oct, lookup step, data unchanged) | correct (€126,10) | correct (€126,10, gpt-6-luna) | no key: greyed, plain reason |
| LifeSystem | sensible plan around the appointments, names the Brain notes; lookup correct | same (also re-run independently: `A/ld/e2e.log` item 8) | same (gpt-6.1-sol) | no key: greyed, plain reason |
| Studio | correct (course outline) | correct | correct (gpt-6.1-sol) | no key: greyed, plain reason |

Sources: finance `A/finance-matrix/matrix.log`; LifeSystem planner build run plus `A/ld/e2e.log`; Studio worker's real runs on a scratch Studio (no raw log kept). The third independent reviewer repeated Studio on claude-cli (haiku) and codex-cli (gpt-6-luna) on its own scratch Studio. Both answered the lookup correctly ("Array basics" has "Array walk" and "Swapping") and refused `ls /` and `/etc/hostname`. OpenAI API runner (acceptance per revision 2 of 2026-11-16): built in both packages against the Responses API and checked against a fake local server (tool call, then answer), a real 401 (logged_out) and a fake 429; with no key it is greyed with a plain reason in all three apps. Its real correct-answer check in the apps is deferred until Daniel has a key.

**R-003 Runner picker per conversation.** The choice is stored on the conversation and survives reload and New chat: finance `bubble-real` (Claude Code · Haiku after reload), LifeSystem `A/ld/ui.log` (Haiku persisted across reload and New chat), Studio `bot-assistant.spec.ts`. The next message runs on the picked runner (finance matrix: each runner's answer came after selecting it).

**R-004 No silent fallback.** Logged out (finance claude-cli with a missing credential), no key (openai-api in all three apps, claude-api in finance), rate limited (`SCRIPT-FAIL rate_limited`, plus fake 429s for both API runners) and missing binary each produced exactly one `error` message with the plain reason, no steps, no tool, no card, and unchanged data (checksums, row counts). `/runners` then shows the runner greyed. A runner with no models (OpenAI without a key) can still be picked and fails plainly (fixed during verification; both demos re-checked). After the first review: a failure that comes after the reply already made a card or change says "What I had already done in this reply is shown above." instead of "Nothing changed." (both packages; checked on both demos with the new `SCRIPT-FAIL-LATER` directive). After the second review the same holds for an unexpected error (not a runner failure), in both packages; parity now covers both cases (`SCRIPT-FAIL-LATER` and the new `SCRIPT-CRASH`, after a card and after reading only) and stays identical at 186 responses. The Python OpenAI runner also refuses tool arguments that arrive as an object instead of a JSON string, rather than crashing.

**R-005 Only the app's tools.** All four runners serve only the app's tools: CLIs through a token-guarded loopback MCP server with built-ins off and a bubblewrap sandbox; APIs declare only app tools. Asked to run `ls /` and read `/etc/hostname`, every real runner in every app refused and no unknown tool ran. Unknown tool calls (`bash`, `write_file`, `rm_rf`) get "There is no tool called X." Forced policy checks: a disallowed Claude tool use and a re-enabled Codex shell were both killed with `policy`.

**R-006 Card or immediate-with-Undo.**
- Cards changed nothing before Apply, and a double Apply (UI double tap plus a direct second request) applied once. A stale card showed a fresh preview and the note, and nothing was applied. Checked in finance, LifeSystem (`A/ld/e2e.log` item 1: 47/47), Studio and the kit demos.
- Immediate changes happened at once, and Undo restored the exact previous state (LifeSystem's five kinds, Studio lesson edits and notes, demo `note.delete`).

**R-007 Starters.** These were app-supplied and shown only in an empty chat, and tapping one sends it. They differ by page in all three apps, and by time of day in LifeSystem (09:00 "Let's plan my day", 14:00 "Replan the rest of my day", 20:00 "Plan tomorrow").

**R-008 Bubble basics.** In all three apps the live step log updates while a reply works, Stop ends it with a partial write-up (`ended: stopped`), New chat starts empty and withdraws open cards, and the time limit gives a write-up (`ended: time`).

**R-009 Finance unchanged.**
- **Checks:** pytest, vitest and build pass.
- **Playwright specs:** finance's re-enabled specs pass on the bot-kit build. That covers chat-controlled 50, just-works-controlled 22, agent-controlled 21 (+1 gated), chat-insights-controlled 14, just-works-upgrade 15, and the real-Claude chat-real 26, just-works-real 4, chat-insights-real 12 and agent-real 9. bubble-real is 10/10 after a date fix in the spec. Together they cover cards, unsure-payment questions, bank-file import, photo, voice, unprompted messages and quiet hours.
- **Migration:** the chat history migration was dry-run on a copy of the real database: 109 messages and 12 cards with identical ids, text and delivery ids, and a no-op on rerun.
- **Look:** side-by-side screenshots of the old chat and the bubble match apart from the new picker (`~/.cache/hf-bot-kit-e2e/look/`).

**R-010 Telegram in the Python package.** `botkit.telegram` is the generic front, and finance's `telegram_bot.py` is a thin plugin. 18/18 scenarios pass against a fake Telegram (`A/telegram-run_all.log`): both group members, stranger ignored, cards, double tap, stale, questions + Remember, document import, photo, voice, quiet hours, delivery ids, Stop, New chat. LifeSystem and Studio have no Telegram chat.

**R-011 Arnold's day plan removed.**
- **Removed from the repo:** the backend, screens, `plan` CLI, skill and docs, plus Today's plans-note section and the "Waiting on you" view, which depended only on that note.
- **Data:** migration 22 drops the proposal, change and ask tables. It renames `plan_events` to `task_events`, keeping the rows, and the calendar sync keeps existing events matching their tasks; this was verified in the fixture app.
- **Live Hermes:** the Daily plan cron job, `day-plan` webhook route, skill link, `plan` link and `HERMES_PLAN_URL` were removed. The removed pieces are recorded in `removed-hermes-pieces.md`. The gateway keeps the old route in memory until its next restart.
- **Docs:** SOUL.md, the check-in skill, Brain `AGENTS.md` and the lifesystem map are updated (Brain commit 37e3949).

**R-012 Planning bot, on request only.** "Let's plan my day" produced a day plan with a schedule card on claude-cli, claude-api and codex-cli. After 3 minutes idle, no message appeared; there is no timer, scheduler or `bot.post`.

**R-013 Researched methods.** `ld-bot-kit/docs/planning-agent-research.md` has 24 sources. The prompt (`backend/app/planner/prompt.py`) names the methods it draws on: time blocking, a daily highlight / Eat the Frog / Ivy Lee, capped lists, planning-fallacy buffers, GTD next actions, implementation intentions and batching.

**R-014 Small immediate, rest on cards.** Move to today, file, set time, rewrite and split happen at once, and Undo restores them exactly; a second Undo does nothing, and Undo after an outside edit is refused. Delete, merge, `task.update` and `day.schedule` wait for Apply. A small change to a task with a linked calendar event is refused and goes on a card (`A/ld/e2e.log` items 1 and 3). Second-review fixes, each checked on the fixture app (`A/ld/e2e_fixes.py`, `A/ld/e2e-fixes.log`): a schedule card applied after its blocks have started is refused with nothing changed; Undo of a filing is refused if a subtask changed since, and is exact otherwise; Undo of a split brings back the focus timer and focus view; the delete card names the calendar events of subtasks it removes.

**R-015 Calendar.**
- **Planning around appointments:** the plan avoids the fixture appointments, and overlapping blocks are refused.
- **Apply:** applying a schedule set 3 task times and created exactly 3 linked events.
- **Follow:** changing a scheduled task's title and time moved its event by the sync, including on the app's own 30 s tick (`A/ld/e2e.log` item 2).

**R-016 Second brain read-only.** Brain search, read and list return fixture notes, and the plans name what they used ("Used: now.md, me/goals.md, journal 15 Nov, plan 13 Nov"). `..`, absolute, `.git` and `.obsidian` paths are refused (absolute paths now with a plain "Absolute paths are not allowed" message), and a symlink out of the vault is refused (checked by the second reviewer on a scratch vault). Vault file hashes, HEAD and `git status` were identical before and after all runs.

**R-017 Studio assistant rebuilt.** The old `server/assistant/*` (except moved domain modules), Assistant UI, routes, prompts, tables (migration 026) and old specs are gone.
- **Generation jobs reviewed before use:** `studio-jobs-review.md` (2026-11-16). "Write a course" and "draft a roadmap" from a card do exactly what their UI buttons do; nothing starts before Apply. Its small fixes were applied (a hand-written lesson is never rewritten by a model; the card says learner edits are kept and when a stopped course carries on; learner-facing wording; the model is looked up before the final check). Daniel's decision on its two larger findings is applied: the assistant rewrites only a held-back lesson (as the course page's "Write it again" offers), never a hand-written one, and the card names the other out-of-date lessons the rewrite takes up too.
- **Job tests added** to `tests/bot-assistant.spec.ts`: draft roadmap, a second write-course card failing at Apply, no model set, the course removed before Apply, a hand-written lesson refused, rewrite a lesson (a standing lesson refused; for a held-back one the card names the out-of-date lesson beside it; nothing before Apply; refused while the course is being written).
- **Other second-review fixes:** exercise starters now show on an open exercise; a `mark_finished` card no longer goes stale the next day (tested by moving the test clock a day); Undo of a lesson edit, a typed undo and Undo of a redo restore "Show original" exactly; dead code removed.
- **Immediate, with Undo:** lesson edits, plus Redo through the model and the Reader's own undo, and notes write.
- **Cards:** note change/delete/merge, mark finished, quiz evidence and generation jobs. `start_job` starts nothing before Apply.
- **Other:** reading the course, progress and page works, and `run_code` returns 42.
- **Tests:** `tests/bot-assistant*.spec.ts` pass on phone and laptop.

**R-018 Default bubble, fully replaceable.** `ts/examples/custom-ui/` is a separate UI that imports only `bot-kit/client` (grep: no `bubble` import). Against the Python demo, the custom UI and the default bubble both showed the same three things:
- A card changed nothing before Apply, and a double Apply plus a direct second request applied once.
- Undo restored the exact note.
- A runner that can't run gave only the plain reason, with no tool run and no data change.

Artifacts: `A/r018/`.

**R-019 Default bubble fits each app.** Every `--bk-*` variable is mapped to each app's day and night tokens and fonts. Screenshots at 390 px and desktop, day and night, in all three apps show no clipping or overlap, and the launcher clears each app's floating controls (finance `~/.cache/hf-bot-kit-e2e/`, LifeSystem `A/ld/shots/`, Studio `~/artifacts/rs-bot-kit-shots/`).

**R-020 Starts from the polished finance chat.** All five options of commit 8ef66c6 are in `ts/src/bubble`:
- quiet grey for the intro, log and note
- card lines in ink at weight 500
- choices on one row with tabular figures
- Rich rendering everywhere
- follow-scroll only for a reader at the end

## Rerun after revision 2 (2026-11-16)

After the first review's fixes, everything the kit changes could touch was run again (`A/rerun-chain.sh`, `A/rerun-chain.log`):
- **Kit and parity:** the kit's TS type check and build pass, and parity is `IDENTICAL: 181`.
- **Finance:** pytest 270 passed; vitest 238 passed; build ok; chat-layout 31 passed (1 fixme); chat-controlled plus bubble-real 60 passed. Telegram passed with every check reported PASS and none FAIL.
- **Studio:** 231 passed.
- **LifeSystem:** `make check` 324 passed.

In the first chain run, one chat-controlled test ("both chats send Claude exactly the same thing") failed once. It passed alone and in the full rerun (60/60). The cause: the prompt's read of this month briefly ran into a SQLite "database is locked" while the open Month page filled the same month, so that one prompt said "This month could not be read just now." The same read path and fallback exist on `main` (`assistant/brain.py`), so this is an existing rare flake, not a change in behaviour.

## Rerun after the second review's fixes (2026-11-16)

Everything ran again after the second round of fixes (`A/rerun-chain.sh` → `A/rerun2-chain.log`, `A/ld-rerun.sh` → `A/ld-rerun.log`):
- **Kit:** the TS build passes. Parity is `IDENTICAL: 186 recorded responses`, now including the partial-failure and crash cases.
- **Finance:** pytest 270; vitest 238; build ok; chat-layout 31 passed (1 fixme); chat-controlled and bubble-real passed (Playwright `.last-run.json`: `passed`, no failed tests). Telegram passed with no FAIL.
- **Studio:** 253 passed, now including the new job, Undo and starter tests. The Studio worker's full-suite run had 1 failure, in a test it had just written; it fixed that test and the four affected specs then passed 73, with 1 skipped.
- **LifeSystem:** `make check` 324 passed. `e2e.py` items 1–6 pass (47, 14, 7, 18, 12 and 1 checks), and the review-fix checks F1–F5 pass (5, 4, 10, 5 and 7 checks).

## Rerun after Daniel's decision on Studio lesson rewrites (2026-11-16)

Studio was the only app the change touched. Its suite now also includes `tests/less-clutter.spec.ts` and `tests/courses.spec.ts` (the course page's own "Write it again" and blocking tests). It gave 345 passed and 9 skipped, with 0 failed (`A/studio-rerun3.log`).

## Third review: approved, with 3 small findings fixed (2026-11-16)

The third independent review approved all 20 requirements. Its three small findings were fixed:
- **Partial-change wording (Python):** if saving a reply failed after the reply had already made a change, the Python package still said "nothing changed". Saving now sits inside the same error handling as in TypeScript, so that case gets the partly-done wording.
- **Claude Code shown as ready when it can't run:** when its private folder sits inside a repository, every reply fails. Its status in the picker now says "Refused to run: the work dir sits under …", in both packages, and Codex's TypeScript status uses the same words. Checked on both demos: inside a git repo it shows `error` with the reason; outside one it shows `ready`. SPEC §3.4 documents this.
- **Studio rewrite card wording:** the card now reads "1 other lesson has something out of date (its text, practice or animation), written again with it: …", which matches what it counts.

That status fix exposed a test-setup problem: Studio's Playwright scratch data sat inside the repo (`.data/e2e`), so both CLIs were now correctly greyed out there and the picker test had nothing to pick. The harness default is now `~/.cache/roadmap-studio-e2e`; `STUDIO_TEST_SCRATCH` still overrides it.

Rerun (`A/rerun3-chain.log`, `A/ld-rerun3.log`, `A/studio-rerun4.log`):
- **Kit:** parity is IDENTICAL at 186.
- **Finance:** pytest 270, vitest 238, build ok, chat-layout 31; chat-controlled and bubble-real passed; Telegram has no FAIL.
- **LifeSystem:** `make check` 324; e2e items 1–6 and F1–F5 all PASS.
- **Studio:** 344 passed, 9 skipped and 1 failed (`A/studio-rerun4.log`). The failure was the new rewrite test on phone: its direct database write hit "database is locked" while an earlier test's slow course was still being written. The test now waits up to 5 s for the lock (`PRAGMA busy_timeout`), and the whole job block then passed 14/14 on phone and laptop.

## Last fix after the fourth review (2026-11-16)

The fourth independent review approved all 20 requirements. One of its small findings was that the new status check prepared the CLI's private home, and so re-linked the credential outside the one-run-at-a-time lock. `PrivateHome.refusal()` now only reads, in both packages. An independent check found it gives the same verdict as a real run would for a home inside a repo, outside one, not yet created, and behind symlinks. Rerun after the fix:
- **Kit:** parity is IDENTICAL at 186.
- **Finance:** pytest 270 passed.
- **LifeSystem:** `make check` 324 passed.
- **Studio:** the assistant specs passed 56 of 56 (`A/studio-final-assistant.log`).

Test scratch from this work was deleted from `/var/tmp`, `~/.cache/roadmap-studio-e2e` and `rs-bot-kit/.data/e2e`. The finance pass records were kept in `A/last-run/`.

## Known limitations
- Codex's status check (both packages, unchanged from the first build) runs `codex login status` / `codex debug models` in the private home outside the one-run-at-a-time lock. If the 60 s status cache runs out during a long Codex run, the check can move a just-refreshed token back to its real place and re-link it while that run continues. This is the same move a run makes itself, so no failure is expected, and none was seen.

- Not tested: a rewrite card on a course that stopped part-way (no test route can stop a course part-way).
- Deferred by Daniel (requirements revision 2): the OpenAI API runner's real correct-answer check, until there is a key.
- Finance `chat-layout` "/setup at 1100 px beside the open panel" fails on `main` and on the new code with the same three elements (NEEDS/WANTS/SAVINGS). This is pre-existing. It is now marked `test.fixme` with that reason so the rest of the file runs: 31 passed, 1 skipped.
- Live leftovers until LifeSystem is deployed: the Hermes gateway keeps the old `day-plan` route in memory until its next restart; `DAILY_PLAN_DIR` stays in `~/.config/life-dashboard/env` because the deployed dashboard still reads it (remove at deploy); the live dashboard shows its last Arnold cards until deploy.
- One real-Claude finance run (agent-real R-006, in a run alongside other suites) was stopped by the claude-cli policy check, which fails closed. It did not recur in 3 repeat runs (27 tests). The reason was not logged because finance's Alembic logging muted the kit's loggers; that is fixed now, so a future stop records why.
- Deploys: finance's deploy script now builds the kit first. Studio and LifeSystem need the kit's `ts/dist` built before installing (see their docs). All three apps reach the kit through a `bot-kit` symlink to `~/code/bot-kit/ts` and an absolute path to `~/code/bot-kit/python`, which works on this machine only. The bot-kit repo has its first local commit (`5f19289`, 2026-11-16), made after Daniel's review; it has no remote.

## Delivered (2026-11-16)

- **bot-kit:** private repo https://github.com/danielvanza/bot-kit, release v0.1.0 (wheel and npm tarball attached). Each app vendors both files in `vendor/`.
- **Finance:** PR #8 merged (`58dc39c`) and deployed with `deploy/deploy.sh`. GitHub CI passed on the PR.
  - `finance.db` was backed up first to `~/.local/share/household-finance/backups/finance-pre-bot-kit-20261116T122429Z.db` (integrity ok, same counts).
  - The migration moved the chat history into `bot.db`: 115 messages and 12 cards.
  - Live: health ok, Claude Code ready, starters answer, no errors in the logs. Telegram bot restarted.
- **LifeSystem:** PR #1 shipped with `life-dashboard-ship` (`d6ec5fa`, rebased over "Agents tab hands its machinery to Understory").
  - Before the deploy, `DAILY_PLAN_DIR` and its "Replies to Arnold" comment were removed from `~/.config/life-dashboard/env`.
  - Live: health ok; migration 22 applied (`user_version` 22, `task_events` in place); the planner store was created.
  - The Hermes gateway was restarted, so the old `day-plan` route is gone from memory.
- **Studio:** local `main` (182 unpushed commits) was pushed first, then PR #4 was merged (`931ce8e`) and deployed with `roadmap-studio-deploy`, which took a database snapshot first. Live: health ok, Claude Code and Codex ready, starters answer.
- **Live checks** were done without sending messages, so nothing was written to the real chats. Real-runner answers were verified earlier on scratch copies of the same code.
- **Cleanup:**
  - The three worktrees and the merged branches (local and on GitHub) were removed.
  - The Anthropic test key was deleted.
- **Not set up live, by design:** the Claude API and OpenAI API runners have no key. Codex in finance has no private home (`CODEX_CLI_HOME` is commented out in its unit). The picker shows each of these as not set up.
