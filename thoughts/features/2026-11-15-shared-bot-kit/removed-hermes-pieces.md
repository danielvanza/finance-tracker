# Hermes pieces removed for R-011 (2026-11-16)

Kept here because ~/.hermes is not under git.

## Cron job (~/.hermes/cron/jobs.json)
```json
{
 "id": "017d95ffb2b2",
 "name": "Daily plan",
 "prompt": "Follow /home/daniel/.hermes/SOUL.md, including the new message limits, explicit agency rules and grounded ambition. Before deciding, read today's refreshed Brain sources/coaching/YYYY/YYYY-MM-DD.md and yesterday's if a commitment crosses days. The pre-run script refreshes these logs. Continue actual conversations: use delivery status and Daniel's actual replies, never assume silence is avoidance. Coaching logs are context only, never personal evidence. Preserve the one-question-at-a-time format. Read and follow /home/daniel/.hermes/SOUL.md for the coach personality. Use second-brain and Brain AGENTS.md; read now.md/index.md, current me/goals.md and me/profile.md, recent journals and today's existing plan, then only relevant project notes. Newer explicit choices outweigh stale goals. Use tasks (life-dashboard, not Todoist) for fresh due/upcoming/completed state and google-workspace for relevant Calendar events. Check completion dates; old completions are not today's progress. Retrieve recent actual user replies with session_search when needed; previous reminders aren't evidence of user agreement or action. Never infer not-started from an open task or availability from an empty calendar. If sources fail, say what matters briefly and avoid invented specifics. Respect explicit skip/snooze/quiet periods using exactly [SILENT] when delivery should be suppressed. Never invoke the three disabled factory/research skills. All times Europe/Amsterdam. \nRun Daniel's adaptive morning coaching at 07:00. Refresh the same Brain plans/YYYY-MM-DD.md in place, preserving last night's chosen outcome and real constraints. Consider today's weekday/weekend, work obligations, appointments, reported energy and personal priorities. Choose ONE ambitious useful outcome aligned with a current goal, its realistic opportunity, and one concrete first move taking 2\u201310 minutes. Add up to two supporting blocks only when capacity warrants them; rest/health/relationships can take priority. Challenge evidenced drift without mechanically enforcing old startup commitments now under reconsideration. If direction conflicts, recommend a choice and ask one question; do not decide his goals for him.\nKeep plan headings Schedule; Focus blocks; Tasks; Postponed; Decisions for Daniel; Updated <time>. Cite last night's choices; label agent proposals and missing capacity information. Never reschedule tasks or edit Calendar as part of the routine; flag conflicts rather than silently moving commitments. Existing unconfirmed tasks do not become Daniel's chosen priorities automatically. Log/index/commit actual Brain writes with agent hermes and explicit changed paths.\nDeliver a natural coach message, at most 150 words, up to 220 only to explain conflicting commitments: a day-specific observation, the main outcome and why it matters, real commitments/constraints, a small starting move and (only if needed) one question. Be blunt, intense and funny without a motivational monologue. No fixed template, copied backlog, fabricated progress or guilt. If he hasn't replied last night, offer a clearly labelled recommendation rather than inventing a choice. Output only the message; don't send a second copy via a messaging tool.\n\nThen run the day-plan skill's morning pass (plan start, small changes, proposals, optionally one schedule), so the proposals wait on the dashboard's Tasks page; keep the Telegram message short as that skill says.",
 "skills": [
  "google-workspace",
  "second-brain",
  "day-plan"
 ],
 "skill": "google-workspace",
 "model": null,
 "provider": null,
 "base_url": null,
 "script": "coaching-context.py",
 "no_agent": false,
 "monitor_script": null,
 "monitor_url": null,
 "monitor_state": null,
 "context_from": null,
 "schedule": {
  "kind": "cron",
  "expr": "0 7 * * *",
  "display": "0 7 * * *"
 },
 "schedule_display": "0 7 * * *",
 "repeat": {
  "times": null,
  "completed": 25
 },
 "enabled": true,
 "state": "scheduled",
 "paused_at": null,
 "paused_reason": null,
 "created_at": "2026-10-24T17:58:05.835634+02:00",
 "next_run_at": "2026-11-16T07:00:00+01:00",
 "last_run_at": "2026-11-15T07:03:27.566851+01:00",
 "last_status": "ok",
 "last_error": null,
 "last_delivery_error": null,
 "last_delivery_unverified": null,
 "last_failure": null,
 "failure_streak": 0,
 "deliver": "telegram",
 "origin": null,
 "enabled_toolsets": null,
 "workdir": "/home/daniel",
 "fire_claim": null,
 "last_dispatch": {
  "scheduled_at": "2026-11-15T07:00:00+01:00",
  "dispatched_at": "2026-11-15T07:00:54.381896+01:00",
  "lateness_seconds": 54.4,
  "kind": "on_time"
 }
}
```

## Webhook route (~/.hermes/config.yaml)
```yaml
        # Replies and day notes typed on the dashboard's Tasks page (life-dashboard docs/dayplan.md).
        day-plan:
          secret: "${PHONE_CAPTURE_SECRET}"
          prompt: |
            Day plan ask {ask_id} from Daniel ({kind}), typed on the dashboard's Tasks page. Use the day-plan skill.
            Proposal it is about (empty for a note about the day): {proposal}
            What he wrote:
            {text}
          skills: ["day-plan"]
          toolsets: ["terminal", "file", "skills", "memory", "session_search"]
          deliver: telegram
```

## Other
- `~/.agents/skills/day-plan` -> `~/apps/life-dashboard/current/hermes/day-plan`
- `~/.local/bin/plan` -> `~/apps/life-dashboard/current/scripts/plan`
- `~/.config/life-dashboard/env` line 43: `HERMES_PLAN_URL=http://127.0.0.1:8644/webhooks/day-plan`
