# Studio generation jobs: review before the assistant starts them (R-017)

Date: 2026-11-16. Worktree `~/code/rs-bot-kit`, branch `feat/shared-bot-kit` (uncommitted), compared with `main`.

## What was reviewed

- Job system: `server/jobs.ts`, `server/ai/generate.ts`, `docs/how-it-works/02-jobs.md`, `server/migrations/026_drop_old_assistant.sql`
- Job handlers and drivers `start_job` reaches: `server/course/generation.ts` (`startGeneration`, `regenerateUnit`, `advance`),
  `server/course/stage-job.ts` (`course.stage`), `server/course/drafts.ts` (`toWrite`, `inputHash`, `isAuthored`),
  `server/roadmap/drafts.ts` (`startDraftWith`, `roadmap.draft`), `server/model.ts` (`requireModel`)
- UI routes for the same work: `server/course/routes.ts` (`/generate`, `/api/units/:id/regenerate`), `server/routes.ts`
  (`/api/roadmap-drafts`, `/api/jobs/:id/retry|cancel`), and the "Write it again" button (`web/src/components/course/PlanRow.tsx:139`)
- `start_job` in `server/bot/changes.ts:449-500`, the kit's `applyCard` (`bot-kit/src/server/service.ts:484`), and the old
  `server/assistant/proposals.ts` on `main`
- Ran `npx playwright test tests/bot-assistant.spec.ts -g start_job --project=laptop`: 1 passed (scratch STUDIO_DATA).

## How jobs work now

- Every piece of model work is one row in `jobs`. `enqueue` writes it as `queued`; `pump` runs the oldest queued job.
- Two lanes, one job at a time in each: `roadmap.draft` alone in "interactive"; everything else, every course stage of
  every course, in "writing". A lesson rewrite waits behind another course that is being written.
- A handler calls the model through `generate()`: parse, validate, and on bad output show the same model its exact errors,
  at most 2 repairs, then fail as `invalid_output`.
- Nothing retries or switches provider by itself. A failed job waits; Retry makes a new row (`retry_of`) with the model set
  now. Retrying twice is one retry (`retryJob` follows the chain).
- Restart: `running` jobs become `failed / interrupted`; `queued` jobs carry on. Old `assistant.reply` jobs are cancelled
  by migration 026, so nothing is left without a handler.
- A course is a chain of `course.stage` jobs. `advance()` keeps no state: it looks at what exists, picks the single next
  thing and queues it, and does nothing while a stage job for that draft is queued or running. That guard is what stops
  duplicates. Each stage takes the model set on the Profile at that moment (`pickFor`), not the one the course started with.
- A roadmap draft is one `roadmap.draft` job; it becomes a roadmap only on Accept.

## How `start_job` starts them

Card kind, three jobs:

| job | preview refuses when | Apply calls | UI button that does the same |
|---|---|---|---|
| `write_course` | no concepts; a draft exists that is not `waiting` | `startGeneration` | Generate now / opening the course |
| `regenerate_lesson` | concept not on the course; lesson not written; course `generating` | `regenerateUnit` + `tick` | Write it again (blocked units only) |
| `draft_roadmap` | empty goal or over 2000 chars | `startDraftWith` | Draft on Roadmaps (8000 chars) |

Apply: the kit moves the card `open/failed -> applying` in one SQL update (a second press does nothing). `fresh()` works
the preview out again; changed data re-shows the card (Stale), a reason that no longer holds fails it with that reason.
Then `requireModel()` (no model or provider logged out fails the card, nothing started), then the same function the UI
route calls, with the same model object.

## Findings

1. **ok: nothing starts before Apply.** All three previews only read (`courseFor`, `getDraft`, `unitOf`). Confirmed by the
   Playwright test (no draft until Start).
2. **ok: model.** Looked up at Apply with `requireModel()`, the same check the UI routes use; the test shows a model changed
   after the card was made is the one used. Later stages follow the Profile setting, as with the UI.
3. **ok: duplicates.** A second `write_course` or `regenerate_lesson` card for a course that is now being written fails at
   Apply ("being written right now"); even if two got through, `startGeneration` and `advance` start nothing while a stage job
   is active. Two `draft_roadmap` cards make two drafts, as pressing Draft twice does.
4. **ok: target removed.** Course gone from the plan or roadmap deleted: `courseFor` fails the card. Concept removed: the card
   fails. Removed during the `requireModel()` wait: `startGeneration` / `regenerateUnit` throw `UserError`, which becomes a
   failed card with nothing written. A course removed after the job started stops itself (`advance`, `course.stage`).
5. **ok: failures and restarts.** Job failures, interrupts and Retry are the job system's, as for the UI. A card cut short
   by a restart is marked failed; its Try again re-checks first, so it cannot start a course twice.
6. **larger: one lesson can mean the whole course.** `regenerateUnit` calls `advance()`, which takes up *everything* out of
   date in the draft, not just that lesson. Unit hashes include the stage prompt versions (`inputHash`), which change often
   (`course.exercises/15`). Scenario: a course written last month, the learner asks to rewrite one lesson, the card says
   "Write the lesson X again"; on Start every lesson and exercise set written under an older prompt version is rewritten and
   reviewed, which is dozens of model runs. The UI's Write it again has the same behaviour. `settleDrawn` (generation.ts:171)
   avoids it for Draw it. Decision: a one-unit run (write that unit, its code check, its visual and its concept's review,
   then stop, like Draw it), or keep it and say on the card how many units are out of date.
7. **larger: an authored lesson can be overwritten by a model.** `regenerate_lesson` accepts any written lesson. For a lesson
   from a bundle (`isAuthored`, `rich: true`), `regenerateUnit` marks it pending, `toWrite` then returns true, and
   `stageLesson` replaces the hand-written multi-part lesson with a generated single lesson. Its authored exercises stay,
   keyed to parts that no longer exist. After Approve the authored text is gone from the Reader. The UI only offers this for
   a blocked unit. Decision: allow `regenerate_lesson` only where the UI offers Write it again (blocked or held units), or
   for any generated lesson but never an authored one. The small fix covers the second choice (see 8).
8. **small: refuse authored lessons.** `server/bot/changes.ts` after line 476 add
   `if (isAuthored(unit)) throw new ChangeError(\`the lesson "${concept.title}" was written by hand, and isn’t written again by a model\`);`
   and import `isAuthored` from `../course/drafts.ts`. This is the minimum whatever 7 decides.
9. **small: a stopped course carries on too.** When the draft is `waiting`, `regenerateUnit` sets it `generating` and
   `advance()` carries on the whole stopped course, but the card only names one lesson. Fix at `changes.ts:479`: when
   `draft.status === 'waiting'`, add the line "The course stopped while it was being written; it carries on from there too."
10. **small: learner's own edits not mentioned.** The old card said a change the assistant made to that lesson is kept beside
   the new text (true: `course_changes` keeps it "one tap away"). The port dropped it. Add that sentence to the second line at
   `changes.ts:479`.
11. **small: model-facing wording shown to the learner.** At Apply a failed re-check shows the preview's reason under
   "That didn't go through". `changes.ts:474` then says "say which lesson: give a conceptId…", which is meant for the model.
   For a learner, "the lesson is no longer on the course" would read better. Cosmetic.
12. **small (optional): look up the model before the re-check.** `changes.ts:482-484` re-checks, then awaits `requireModel()`
   (can take seconds when the provider status isn't cached), then starts. The old code looked the model up first so check and
   start ran with no wait between them. Effect today is harmless (see 4), but swapping the two lines restores that.
13. **small: tests.** Only `write_course` is covered. Missing: `regenerate_lesson` (incl. refused while generating),
   `draft_roadmap`, a second card failing at Apply, no model set (card fails, nothing queued), course removed before Apply.
14. **ok, by choice: no Undo on a job card.** The old card offered Undo (stop writing / discard draft). The new one links to
   the course or draft page, where Stop and Discard are. Fine, but the card could say so.

## Verdict

Sound for `write_course` and `draft_roadmap` as built: they do exactly what the UI does, only on Apply, with the
Profile model at Apply, and duplicates and removed targets fail cleanly. `regenerate_lesson` does more than its card says
(6, 9) and can replace an authored lesson (7). Apply fix 8 before relying on it, and decide 6 and 7.

## Outcome (2026-11-16)

- Small fixes 1–5 were applied in `server/bot/changes.ts`. Fix 6 is covered by end-to-end tests in `tests/bot-assistant.spec.ts`.
- **Findings 6 and 7, Daniel's decision:** the assistant may rewrite only a lesson that the course page's "Write it again" button is offered for, meaning one blocked by its code check or held back by the review. Any other lesson is refused, and so is a hand-written lesson. The card names the other out-of-date lessons that the rewrite takes up as well ("1 other lesson has something out of date (its text, practice or animation), written again with it: …"). Since that list is part of the preview, Apply shows the card again if it changed in the meantime. The button keeps its current behaviour.
- **Test:** the end-to-end test passes on phone and laptop. A standing lesson is refused; for a held-back lesson the card names the out-of-date lesson beside it, nothing starts before Apply, and the course is being written after Apply.
