# Finance agent: talk to it like Claude, with tools for the household's money

## Starting point and direction

**Starting point.** After the chat insights went live, two real uses failed: "Can we go through all the imported guesses together?" was first blocked by the rule against cards after a lookup, and then turned into an error because Claude copied one wrong id into a 420-row card. Daniel said what he actually wants: "a Claude UI or ChatGPT thing where I can just talk to it but it has the tools to look into my finances and do stuff there."

**Converged direction.** Rebuild the finance chat (web panel and Telegram) as a conversational agent. It keeps one ongoing conversation per chat, answers freely about household money, uses the app's tools as often as it needs, and shows changes as cards (including large batches) that need Apply. It keeps running on the household's sandboxed Claude login. For both members of the household.

## Decisions

- **Own agent in the app, not a connector to the Claude app.** Keeps Telegram, works for both people and keeps the Apply safety.
- **Changes: card + Apply, batch-friendly.** One card can carry a big batch, so reviewing hundreds of guesses is quick.
- **Memory: one thread per place, with New chat.** Telegram and the panel stay separate; /new or New chat starts fresh.
- **Abilities: everything the app can change,** including savings goals, which the chat could not touch before.
- **Replies: fully free, but focused on the household's finances.** No fixed layouts and no "Based on" line.
- **Reviewing guesses: the agent chooses the grouping.**
- **Time per reply: up to about 10 minutes**, accepting that the other person's messages wait meanwhile.
- **Progress: a full step-by-step log, in plain words.**
- **Stopping: a Stop button in both chats, plus stop or /stop in Telegram.**

## Alternatives considered

- **Connect the finances to the Claude app as a connector.** The real Claude interface, but the app would have to be reachable from the internet with a proper sign-in, each person needs their own Claude account and setup, changes would be confirmed through Claude's own prompts rather than cards, and Telegram would drop out. Not chosen.
- **Keep patching the current structure** (refusals back to Claude, an "all guesses" option, batches by category). It fixes the two failures but keeps the stiff one-reply-per-message design Daniel no longer wants. Folded into the agent instead.
- **Strict figure checks.** They made replies stiff and caused stuck answers. Replaced by honesty in the agent's instructions (R-004).
- **Small changes applied directly with Undo, or everything direct.** Rejected in favour of always confirming with a card.
- **Several saved chats like Claude.ai, or one thread shared by Telegram and the panel.** Not chosen; one thread per place with New chat is enough.
- **About 3 minutes per reply, or no limit.** 10 minutes chosen; no limit could let one stuck reply block both chats.
- **Short status lines, or only a working indicator.** A full log chosen.
- **A new message redirecting the agent, or no stopping.** A Stop button chosen.

## Grounding notes

Checked in the code and live logs on 2026-11-10:
- The current chat starts a fresh `claude -p` run per message with a bounded snapshot and the last 12 messages (`backend/assistant/brain.py`). It must end with one reply tool (`backend/assistant/tools.py`).
- Tools reach Claude as a private loopback MCP server inside the existing bubblewrap sandbox, with built-in tools off (`backend/categorizer/claude_cli.py`).
- In production, 420 imported guesses were waiting. The failed review attempts are visible in the sandbox's MCP logs: first `propose_change` refused after lookups, then `review.confirm` rejected because one id was a manual McD entry rather than a guess (`backend/assistant/actions.py:204`).
- The earlier feature folders: `thoughts/features/2026-11-09-finance-chat-assistant/` and `thoughts/features/2026-11-09-chat-insights/`.
- Telegram supports buttons under a bot's own message, editing that message as a live log, and bot commands such as /stop and /new.

## Optional wishes and carried-forward uncertainties

Not agreed scope:
- Whether the agent should suggest rules while reviewing guesses, so later imports sort themselves.
- How a reply of up to 10 minutes fits with the single sandboxed Claude login that imports also use.
- Which model runs the agent, and whether the existing chat model is good enough for long tool use.
- How a very long conversation is kept within what Claude can read at once.
- Whether the two open findings from the first chat feature (faint chat text, savings goals) are settled here or there; R-005 now covers savings goals.
