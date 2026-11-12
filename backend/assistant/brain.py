"""What Claude is given to work with, and running it for one reply."""
import json
import logging
import os
import time
from dataclasses import dataclass, field

from sqlalchemy import func
from sqlalchemy.orm import Session

import clock
from assistant import queries
from assistant.prompts import STOPPED_AT_LIMIT, STOPPED_BY_PERSON, SYSTEM_PROMPT, WRAP_UP
from assistant.tools import ProposeChange, Toolbox
from categorizer import claude_cli
from models import ChatMessage, Transaction

logger = logging.getLogger(__name__)

MODEL = os.getenv("CHAT_MODEL", "sonnet")
TIME_LIMIT_SECONDS = float(os.getenv("CHAT_TIME_LIMIT_SECONDS", "540"))  # Claude's own work on one reply
WRAP_UP_SECONDS = 60  # then writing up what it found, if it was stopped: about ten minutes in all
MIN_CALL_SECONDS = 5
MAX_CONVERSATION_CHARS = 600_000  # far more than a household conversation reaches; a guard, not a window
MAX_WORK_CHARS = 60_000
MAX_CARD_ARGS = 1500
NEW_CHAT = "new_chat"  # a marker row: the agent and the panel start after the newest one

STOPPED_BEFORE = "Stopped. I had not found anything yet, so I have nothing to add, and nothing changed."
TIMED_OUT_BEFORE = "That took longer than one reply may take, so I stopped early, before I had found anything. Nothing changed."
STOPPED_FALLBACK = "I stopped early, and could not write up what I had found. Nothing changed."
SAYS_STOPPED = ("stop", "time limit", "ran out of time", "cut short", "partial")


def conversation_start(db: Session, channel: str) -> int:
    """The id after which the current conversation starts."""
    return db.query(func.max(ChatMessage.id)).filter(
        ChatMessage.channel == channel, ChatMessage.kind == NEW_CHAT,
    ).scalar() or 0


def history_of(db: Session, channel: str, before_id: int) -> list[ChatMessage]:
    """The current conversation up to a message, in full."""
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.channel == channel, ChatMessage.id > conversation_start(db, channel),
                ChatMessage.id < before_id, ChatMessage.kind != NEW_CHAT)
        .order_by(ChatMessage.id).all()
    )


def _entry(message: ChatMessage) -> dict | None:
    payload = message.payload or {}
    if message.role == "user":
        if message.kind == "file":
            return {"from": "person", "sent_a_bank_file": message.text}
        entry = {"from": "person", "text": message.text}
        if message.kind == "photo":
            entry["sent_a_photo"] = True
        if message.kind == "voice":
            entry["heard_from_a_voice_note"] = True
        if (message.payload or {}).get("ended") == "stopped":
            entry["note"] = "they pressed Stop while you worked on this"
        return entry
    if message.kind == "proposal" and message.proposal:
        card = message.proposal
        shown = {"id": card.id, "summary": card.summary, "op": card.op, "rows_changed": len(card.preview["changes"]),
                 "status": card.status}
        if len(json.dumps(card.args)) <= MAX_CARD_ARGS:
            shown["args"] = card.args
        if card.error:
            shown["error"] = card.error
        entry = {"from": "app", "card": shown}
        if payload.get("says"):
            entry["you_said_with_it"] = payload["says"]
        return entry
    if message.kind == "question":
        asked = {"asked": message.text, "transaction_ids": payload.get("transaction_ids", []),
                 "buttons": [o["label"] for o in payload.get("options", [])]}
        if payload.get("status") == "answered":
            asked["outcome"] = payload.get("result")
        return {"from": "app", **asked}
    if message.kind == "nudge":
        return {"from": "app", "sent_unasked": message.text}
    if message.kind == "import":
        return {"from": "app", "import_summary": message.text}
    if message.kind == "error":
        return {"from": "app", "error": message.text}
    entry = {"from": "you", "text": message.text}
    if payload.get("about_question"):  # they pressed "Something else" on a question, and the app asked this
        entry = {"from": "app", "asked_after_something_else": message.text, "transaction_ids": payload.get("transaction_ids", [])}
    options = (message.payload or {}).get("options")
    if options:
        entry["choices_shown"] = [f"{o['description']}, {o['date_label']}, {o['amount_label']} (id {o['id']})" for o in options]
    if (message.payload or {}).get("chart"):
        entry["chart_shown"] = message.payload["chart"].get("title") or "a chart"
    return entry


def build_prompt(db: Session, channel: str, message: ChatMessage) -> str:
    entries = [e for e in (_entry(m) for m in history_of(db, channel, message.id)) if e]
    text = json.dumps(entries, ensure_ascii=False)
    while len(text) > MAX_CONVERSATION_CHARS and len(entries) > 1:
        entries = [{"from": "app", "note": "The start of this conversation was too long to include."}, *entries[len(entries) // 4 + 1:]]
        text = json.dumps(entries, ensure_ascii=False)
    waiting = db.query(func.count(Transaction.id)).filter(Transaction.confirmed == False).scalar()  # noqa: E712
    try:
        this_month = queries.month_overview()
    except Exception:
        logger.exception("[chat] reading this month for the prompt failed")
        this_month = {"error": "This month could not be read just now."}
    # Bounded: one month, whatever the history holds. Everything else is looked up when a reply needs it.
    context = {"today": clock.today().isoformat(), "payments_waiting_for_an_answer": waiting, "this_month": this_month}
    said = message.text
    if message.kind == "photo":
        said = {"sent_a_photo": True, "caption": message.text or None}
    elif message.kind == "voice":
        said = {"heard_from_a_voice_note": message.text}
    return (
        f"<context>\n{json.dumps(context)}\n</context>\n\n"
        f"<conversation>\n{text}\n</conversation>\n\n"
        f"<new_message>\n{json.dumps(said, ensure_ascii=False)}\n</new_message>"
    )


class UnreadableReply(Exception):
    pass


@dataclass
class Reply:
    text: str
    chart: dict | None = None
    choices: list[int] = field(default_factory=list)
    cards: int = 0
    ended: str | None = None  # "stopped" or "time" when it did not finish
    lookups: int = 0


class _Clock:
    """The time for one reply. Time spent queued behind another Claude run does not count."""

    def __init__(self) -> None:
        self._deadline = time.monotonic() + TIME_LIMIT_SECONDS
        self._waiting_since: float | None = None

    def on_wait(self, waiting: bool) -> None:
        if waiting:
            self._waiting_since = time.monotonic()
        elif self._waiting_since is not None:
            self._deadline += time.monotonic() - self._waiting_since
            self._waiting_since = None

    def left(self) -> float:
        return self._deadline - time.monotonic()


def _wrap_up(prompt: str, work: list[dict], ended: str) -> str:
    """Claude, stopped, says what it had found. Without lookups there is nothing to say."""
    if not work:
        return STOPPED_BEFORE if ended == "stopped" else TIMED_OUT_BEFORE
    found = json.dumps(work, ensure_ascii=False)[:MAX_WORK_CHARS]
    why = STOPPED_BY_PERSON if ended == "stopped" else STOPPED_AT_LIMIT
    asked = f"{prompt}\n\n<work_so_far>\n{found}\n</work_so_far>\n\n{WRAP_UP.format(why=why)}"
    try:
        text = claude_cli.complete(SYSTEM_PROMPT, asked, MODEL, WRAP_UP_SECONDS).strip()
    except claude_cli.ClaudeCliError:
        return STOPPED_FALLBACK
    if not text:
        return STOPPED_FALLBACK
    if not any(word in text.lower() for word in SAYS_STOPPED):
        text = f"I stopped early, so this is partial.\n\n{text}"
    return text


def converse(
    prompt: str, on_wait, on_step, propose, should_stop, abandoned=lambda: False, picture: bytes | None = None,
) -> Reply:
    """Let Claude work the reply out with its tools, for up to the time limit or until stopped.

    propose(ProposeChange) makes a card and returns None, or why the app would not take it. abandoned() says
    nobody will see the reply any more (a new chat was started), so a stopped run is not written up.
    Claude errors propagate.
    """
    clock = _Clock()

    def waited(waiting: bool) -> None:
        clock.on_wait(waiting)
        on_wait(waiting)

    with Toolbox(on_step, propose) as toolbox:
        try:
            said = claude_cli.complete(
                SYSTEM_PROMPT, prompt, MODEL, max(clock.left(), MIN_CALL_SECONDS), waited,
                tools=toolbox.config, allowed_tools=toolbox.allowed_tools(), should_stop=should_stop,
                picture=picture,
            ).strip()
        except claude_cli.Stopped:
            ended = "stopped"
        except claude_cli.TimedOut:
            ended = "time"
        else:
            if not said and not toolbox.cards:
                raise UnreadableReply()
            return Reply(said, toolbox.chart, toolbox.choices, toolbox.cards, lookups=toolbox.lookups)
        work, cards, lookups = list(toolbox.work), toolbox.cards, toolbox.lookups
    if abandoned():
        return Reply("", cards=cards, ended=ended, lookups=lookups)
    on_step("Stopped. Writing up what I found so far" if work else "Stopped")
    return Reply(_wrap_up(prompt, work, ended), cards=cards, ended=ended, lookups=lookups)


__all__ = ["ProposeChange", "Reply", "UnreadableReply", "build_prompt", "converse", "history_of", "conversation_start"]
