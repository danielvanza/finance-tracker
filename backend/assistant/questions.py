"""What the app says in the chat without Claude: questions about payments Claude was not sure of, the answers to
them, and the unasked messages from nudges.py. All of it is posted through the bot kit (`bot.post`) and kept in its
store; the buttons are botkit actions (SPEC §7), handled here.

A few questions are open at a time, in the Telegram group (QUESTION_CHANNEL). A question is only asked once Claude
has judged the payment, or gave no answer for it. Whatever nobody asked for carries `unasked` and waits out the
quiet hours. One unasked message the chat has not been shown yet is replaced by the next (`post_nudge`).
"""
import json
import logging
import os
import threading

from sqlalchemy import func

import clock
import guesses
from assistant import actions
from botkit import ActionContext
from categorizer import claude_cli
from db import SessionLocal
from importers.ing import written
from models import Category, Transaction

logger = logging.getLogger(__name__)

QUESTIONS_OPEN = 3  # how many questions about waiting payments are in front of the household at once
QUESTION_CHANNEL = "telegram"
HISTORY_LIMIT = 400
NOTE_CHARS = 80  # how much of what a payer typed is shown beside a payment in a question
REMEMBER_NAME = 30  # how much of a shop's name fits on the button that offers to remember it
SOMETHING_ELSE = "Tell me in a few words what {name} is, and I will sort it."
SOMETHING_ELSE_LABEL = "Something else"


def _bot():
    from assistant.bot import bot  # the bot needs this module for its actions, so it is reached at call time

    return bot()


# ---- The questions --------------------------------------------------------------------------------

def _question_text(group: guesses.Group) -> str:
    first = actions.describe_transaction(group.rows[0])
    if len(group.rows) == 1:
        what = f"{group.name}, {first['date_label']}, {first['amount_label']}"
    else:
        what = f"{group.name}: {len(group.rows)} payments, {actions.eur(abs(group.total_cents))} in all"
    return f"{what}. {'What was this money for?' if group.incoming else 'Where does it belong?'}"


def question_buttons(payload: dict) -> list[dict]:
    """An open question: one button per likely category, then Something else. An answered one: the offer to
    remember the shop, while it stands."""
    if payload.get("status") == "open":
        return [*({"action": "answer", "label": option["label"][:60], "value": i}
                  for i, option in enumerate(payload.get("options") or [])),
                {"action": "something_else", "label": SOMETHING_ELSE_LABEL, "style": "quiet"}]
    offer = payload.get("offer")
    return [{"action": "remember", "label": offer["label"]}] if offer else []


def _open_questions(db, channel: str) -> list[dict]:
    """The questions in a channel still waiting for an answer, newest first, as stored messages."""
    rows = db.execute(
        "SELECT id, payload, delivered FROM bot_messages WHERE channel = ? AND kind = 'question'"
        " ORDER BY id DESC LIMIT ?", (channel, HISTORY_LIMIT),
    ).fetchall()
    out = []
    for row in rows:
        payload = json.loads(row["payload"] or "{}")
        if payload.get("status") == "open":
            out.append({"id": row["id"], "payload": payload})
    return out


def refresh(channel: str) -> None:
    """A question whose payments were sorted some other way is closed, and its message brought up to date.
    Runs before a chat reads its messages (botkit's `refresh`)."""
    store = _bot().store
    with store.connect() as db:
        open_now = _open_questions(db, channel)
    if not open_now:
        return
    closed = {}
    with SessionLocal() as session:
        for question in open_now:
            rows = [session.get(Transaction, i) for i in question["payload"].get("transaction_ids", [])]
            if any(t is not None and not t.confirmed for t in rows):
                continue
            went_to = {t.category.name for t in rows if t is not None and t.category is not None}
            closed[question["id"]] = f"Sorted as {went_to.pop()}." if len(went_to) == 1 else "Sorted."
    if not closed:
        return
    with store.write() as db:
        for message_id, result in closed.items():
            current = store.message(message_id, db)
            if current is None or (current["payload"] or {}).get("status") != "open":
                continue
            store.merge_payload(db, message_id, status="answered", result=result, buttons=[])


def _can_judge() -> bool:
    return bool(claude_cli.enabled() or os.getenv("ANTHROPIC_API_KEY"))


_no_answer: set[int] = set()  # payments Claude was asked about and gave no answer for, since the app started
_asking = threading.Lock()  # an import, a finished backlog and the nudge tick may all ask at the same moment


def ask_questions(channel: str = QUESTION_CHANNEL, unasked: bool = False) -> int:
    """Put the next waiting payments to the household, a shop at a time, until enough questions are open.

    Returns how many were added. The largest amounts are asked about first. A payment Claude has not looked at yet
    is not asked about while Claude can still be asked: it may well be sure. One Claude gave no answer for is asked
    about like the rest. `unasked` marks questions nobody in the chat prompted, which keep the quiet hours.
    """
    bot = _bot()
    with _asking:
        refresh(channel)
        with bot.store.connect() as db:
            open_now = _open_questions(db, channel)
        asked = {q["payload"].get("key") for q in open_now}
        added = 0
        with SessionLocal() as session:
            for group in guesses.groups(session, judged_only=_can_judge(), tried=_no_answer):
                if len(open_now) + added >= QUESTIONS_OPEN:
                    break
                if group.key in asked:
                    continue
                rows = group.rows
                payload = {
                    "status": "open", "key": group.key, "name": group.name, "incoming": group.incoming,
                    "transaction_ids": [t.id for t in rows], "count": len(rows), "total_cents": group.total_cents,
                    "examples": [
                        {**{k: actions.describe_transaction(t)[k] for k in ("date_label", "amount_label", "description")},
                         "note": " ".join(written(t.note).split())[:NOTE_CHARS]}
                        for t in rows[:3]
                    ],
                    "options": guesses.options_for(session, group),
                }
                bot.post(channel, "question", _question_text(group), payload, unasked=unasked,
                         buttons=question_buttons(payload))
                added += 1
        return added


def _remember_label(rows: list[Transaction]) -> str:
    if len(rows) == 1:
        return f"Remember {guesses.shop_name(rows[0])[:REMEMBER_NAME]} for next time"
    return f"Remember these {len(rows)} shops"


def remembered_text(rules: list) -> str:
    if not rules:
        return "Nothing was remembered: the payment has changed since."
    if len(rules) == 1:
        return f"Remembered: “{rules[0].pattern}” → {rules[0].category.name}."
    return f"Remembered {len(rules)} shops for next time."


# ---- The question's buttons (botkit actions) ------------------------------------------------------

def _question_payload(ctx: ActionContext) -> dict | None:
    if ctx.message.get("kind") != "question":
        return None
    return dict(ctx.message.get("payload") or {})


def answer(ctx: ActionContext) -> None:
    """A tap on one of a question's categories: its payments are sorted, remembering the shop is offered, and the
    next question is asked."""
    payload = _question_payload(ctx)
    if payload is None or payload.get("status") != "open":
        return
    options = payload.get("options", [])
    option = ctx.value if isinstance(ctx.value, int) and not isinstance(ctx.value, bool) else -1
    if not 0 <= option < len(options):
        return
    with SessionLocal() as db:
        category = db.get(Category, options[option]["category_id"])
        offer = None
        if category is None:
            result = "That category no longer exists, so nothing was sorted. Tell me where it belongs."
        else:
            rows = [db.get(Transaction, i) for i in payload.get("transaction_ids", [])]
            done = guesses.answer(db, [t for t in rows if t is not None], category)
            count = f"{len(done)} payment{'' if len(done) == 1 else 's'}"
            if not done:
                result = "These were already sorted."
            else:
                result = f"{options[option]['label']}. {count} sorted."
                if guesses.to_remember(db, done[:1]):
                    offer = {"transaction_id": done[0].id, "label": _remember_label([done[0]])}
        db.commit()
    payload.update(status="answered", result=result, **({"offer": offer} if offer else {}))
    ctx.update(payload={k: payload[k] for k in ("status", "result", "offer") if k in payload},
               buttons=question_buttons(payload))
    ask_questions(ctx.channel)


def remember(ctx: ActionContext) -> None:
    """A tap on "Remember … for next time" under an answered question: the shop gets its rule."""
    payload = _question_payload(ctx)
    offer = (payload or {}).get("offer")
    if not offer:
        return
    with SessionLocal() as db:
        tx = db.get(Transaction, offer["transaction_id"])
        rule = guesses.remember(db, tx) if tx is not None and tx.confirmed else None
        said = remembered_text([rule] if rule else [])
        db.commit()
    ctx.update(payload={"offer": None, "result": f"{payload.get('result') or 'Sorted.'}\n{said}"}, buttons=[])


def something_else(ctx: ActionContext) -> None:
    """A tap on a question's "Something else": the app asks what it is, as a line of the conversation, so that
    Claude knows which payment the words that follow are about."""
    payload = _question_payload(ctx)
    if payload is None or payload.get("status") != "open" or payload.get("asked_what"):
        return
    ctx.update(payload={"asked_what": True})
    ctx.say("answer", SOMETHING_ELSE.format(name=payload.get("name") or "this"),
            {"about_question": ctx.message["id"], "transaction_ids": payload.get("transaction_ids", [])})


# ---- After an import, and at startup ------------------------------------------------------------

def after_import(asked_in_chat: bool = False) -> None:
    """New rows are in: ask about the ones Claude was not sure of.

    A file sent in the chat was asked for there, so its questions follow at once. After an import on the Import
    page, or at startup, they are unasked messages and keep the quiet hours: at night they wait for the morning
    (nudges.tick asks them then).
    """
    _ask_unless_night(asked_in_chat)
    # Rows the import ran out of time for are judged in the background, and asked about after that.
    with SessionLocal() as db:
        unjudged = any(t.ai_options is None and not t.is_refund for t in guesses.waiting(db))
    if unjudged and _can_judge():
        threading.Thread(target=_settle_backlog, args=(asked_in_chat,), name="settle-backlog", daemon=True).start()


def _ask_unless_night(asked_in_chat: bool = False) -> None:
    if not asked_in_chat and clock.quiet_hours():
        return
    try:
        ask_questions(unasked=not asked_in_chat)
    except Exception:
        logger.exception("[chat] asking about waiting payments failed")


_settling = threading.Lock()


def _settle_backlog(asked_in_chat: bool = False) -> None:
    """Payments nobody has judged yet (those that waited from before guesses were sure-or-doubtful, or that an
    import ran out of time for): judge them now, a hundred at a time, then ask about the rest, those Claude could
    not be reached for included."""
    if not _settling.acquire(blocking=False):
        return  # already at it
    try:
        for _ in range(50):
            with SessionLocal() as db:
                counts = guesses.judge_backlog(db)
            _no_answer.update(counts["no_answer"])
            judged = counts["sure"] + counts["doubtful"] + counts["by_rule"]
            if not judged or not (counts["more"] or counts["left"]):
                break
        _ask_unless_night(asked_in_chat)
    except Exception:
        logger.exception("[chat] judging the waiting payments failed")
    finally:
        _settling.release()


def resume() -> None:
    """At startup: payments nobody has judged yet are judged in the background."""
    if _can_judge():
        threading.Thread(target=_settle_backlog, name="settle-backlog", daemon=True).start()


def waiting_count() -> int:
    with SessionLocal() as db:
        return db.query(func.count(Transaction.id)).filter(Transaction.confirmed == False).scalar()  # noqa: E712


# ---- What nudges.py says unasked ------------------------------------------------------------------

def _unshown_nudges(db, channel: str) -> list:
    return db.execute(
        "SELECT id, text, payload FROM bot_messages WHERE channel = ? AND kind = 'nudge' AND role = 'assistant'"
        " AND delivered IS NULL ORDER BY id", (channel,),
    ).fetchall()


def waiting_nudge(channel: str) -> tuple[set[str], str | None]:
    """What the app said unasked that nobody has been shown yet: which messages it holds, and its words."""
    with _bot().store.connect() as db:
        unshown = _unshown_nudges(db, channel)
    kinds = {kind for row in unshown for kind in (json.loads(row["payload"] or "{}").get("nudge") or "").split("+")
             if kind}
    return kinds, (unshown[-1]["text"] if len(unshown) == 1 else None)


def post_nudge(channel: str, text: str, payload: dict) -> int:
    """Say something unasked. It takes the place of whatever unasked message still waits to be shown, so a chat
    that could not be reached for a while gets one message, not a row of them. With no text, what waits is only
    taken back: it no longer holds."""
    bot = _bot()
    if text:
        return bot.post(channel, "nudge", text, {k: v for k, v in payload.items() if k != "unasked"},
                        unasked=True, replace_unshown=True)
    with bot.store.write() as db:
        db.execute("DELETE FROM bot_messages WHERE channel = ? AND kind = 'nudge' AND role = 'assistant'"
                   " AND delivered IS NULL", (channel,))
    return 0
