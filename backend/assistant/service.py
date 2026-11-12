"""The conversation: saving messages, working through them one at a time, and Yes or No."""
import hashlib
import json
import logging
import os
import re
import threading
from datetime import datetime, timezone

from sqlalchemy import func, update

import clock
import guesses
import import_service
import voice
from assistant import actions, brain, charts
from categorizer import claude_cli
from db import SessionLocal
from importers.ing import BadFile, parse_ing
from models import Category, ChatMessage, ChatProposal, Transaction

logger = logging.getLogger(__name__)

CHANNELS = ("bubble", "telegram")
HISTORY_LIMIT = 400
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PICTURE_BYTES = 8 * 1024 * 1024
QUESTIONS_OPEN = 3  # how many questions about waiting payments are in front of the household at once
QUESTION_CHANNEL = "telegram"
_IN_FLIGHT = ("queued", "running", "waiting", "stopping")
_STOPPED_IN_LINE = "Stopped before I started on that. Nothing changed."
ONLY_ING = "I can only read an ING export: a CSV file from ING, with English or Dutch column names."
_SHOW_ALL = {
    "show all", "show everything", "show them all", "show all rows", "show the rows", "all rows", "list them",
    "list them all", "list all", "show me all", "show me everything",
}
_STALE_NOTE = "Something changed since this was shown, so nothing was applied. Check it again."
_MERGE_CHECK_FAILED = (
    "The import is saved. The check for payments entered twice did not finish, "
    "so a manual entry may now be counted twice."
)
_YES = {"yes", "y", "ja", "yep", "yeah", "ok", "okay", "oké", "apply", "confirm", "ja graag", "yes please", "doe maar"}
_NO = {"no", "n", "nee", "nope", "not this", "cancel", "niet doen"}

_worker: threading.Thread | None = None
_worker_guard = threading.Lock()


class NotFound(Exception):
    pass


class _AlreadySettled(Exception):
    pass


# ---- What the chats read ------------------------------------------------------------------------

def _version(preview: dict) -> str:
    """Identifies what a card shows, so a tap can be matched to the version that was on screen."""
    return hashlib.sha256(json.dumps(preview, sort_keys=True).encode()).hexdigest()[:8]


def card_of(proposal: ChatProposal) -> dict:
    merge = proposal.op == "merge"
    plain = actions.plain(proposal.preview)
    applied = proposal.status == "applied"
    effect = (proposal.result or {}).get("effect", []) if applied else proposal.preview.get("effect", [])
    return {
        "id": proposal.id,
        # What the card says, in the app's own words: a line per change, or a summary when there are many.
        "lines": plain["lines"],
        "summed_up": plain["summed_up"],
        "rows": plain["rows"],
        "effect_lines": actions.plain_effect(effect, applied),
        "says": (proposal.message.payload or {}).get("says"),
        "status": proposal.status,
        "version": _version(proposal.preview),
        "summary": proposal.summary,
        "note": proposal.note,
        "changes": proposal.preview["changes"],
        "purchase": proposal.preview.get("purchase"),
        "effect": proposal.preview.get("effect", []),
        "error": proposal.error,
        "result": proposal.result,
        "heading": "Looks like the same payment" if merge else "Proposed change",
        "apply_label": "Merge" if merge else "Apply",
        "reject_label": "Keep both" if merge else "Not this",
        "message_id": proposal.message_id,
        "message_ids": proposal.message.delivered_ids or [],
    }


def message_out(message: ChatMessage) -> dict:
    out = {
        "id": message.id, "role": message.role, "kind": message.kind, "text": message.text,
        "status": message.status, "reply_to": message.reply_to,
        "created_at": message.created_at.replace(tzinfo=None).isoformat() + "Z",
        "payload": message.payload,
        "delivered_ids": message.delivered_ids,
        "card": None,
    }
    if message.proposal:
        out["card"] = card_of(message.proposal)
    return out


def conversation(channel: str) -> dict:
    """The current conversation, from the last New chat on."""
    with SessionLocal() as db:
        rows = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == channel, ChatMessage.id > brain.conversation_start(db, channel))
            .order_by(ChatMessage.id.desc()).limit(HISTORY_LIMIT).all()
        )
        waiting = db.query(func.count(Transaction.id)).filter(Transaction.confirmed == False).scalar()  # noqa: E712
        return {
            "messages": [message_out(m) for m in reversed(rows)],
            "guesses_waiting": waiting,
            "claude_busy": claude_cli.busy(),
        }


def outbox(channel: str) -> dict:
    """What a chat that pushes to its reader still has to show, what it shows that has changed since
    (`edits`), and what is still being worked on."""
    with SessionLocal() as db:
        _refresh_questions(db, channel)
        working = (
            db.query(ChatMessage).filter(ChatMessage.channel == channel, ChatMessage.status.in_(_IN_FLIGHT))
            .order_by(ChatMessage.id).all()
        )
        busy_with = {m.id for m in working if m.status != "queued"}
        undelivered = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == channel, ChatMessage.role == "assistant", ChatMessage.delivered_ids == None)  # noqa: E711
            .order_by(ChatMessage.id).all()
        )
        # A card waits for the words that go with it, so both arrive as one message.
        replies = [r for r in undelivered if not (r.kind == "proposal" and r.reply_to in busy_with)]
        # What the app says without being asked keeps the quiet hours at delivery too: a message made in
        # the evening that could not be shown then waits for the morning.
        if clock.quiet_hours():
            replies = [r for r in replies if not (r.payload or {}).get("unasked")]
        shown = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == channel, ChatMessage.role == "assistant", ChatMessage.delivered_ids != None,  # noqa: E711
                    ChatMessage.kind.in_(("question", "proposal")))
            .order_by(ChatMessage.id.desc()).limit(HISTORY_LIMIT).all()
        )
        edits = [m for m in reversed(shown) if (m.payload or {}).get("refresh")]
        first_reply = {}
        for reply in replies:
            first_reply.setdefault(reply.reply_to, reply.id)
        out_replies = []
        for reply in replies:
            out = message_out(reply)
            asked = db.get(ChatMessage, reply.reply_to) if reply.reply_to else None
            earlier = asked is not None and db.query(ChatMessage.id).filter(
                ChatMessage.reply_to == asked.id, ChatMessage.id < reply.id, ChatMessage.role == "assistant",
            ).first()
            if asked is not None and asked.kind == "voice" and first_reply[reply.reply_to] == reply.id and not earlier:
                out["heard"] = asked.text  # the first reply to a voice note shows what was heard
            out_replies.append(out)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        return {
            "replies": out_replies,
            "edits": [message_out(m) for m in edits],
            "in_flight": [
                {"id": m.id, "kind": m.kind, "status": m.status, "age_seconds": (now - m.created_at.replace(tzinfo=None)).total_seconds(),
                 "steps": (m.payload or {}).get("steps", []), "heard": m.text if m.kind == "voice" else None}
                for m in working
            ],
        }


def chart_of(message_id: int, theme: str) -> bytes:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        chart = (message.payload or {}).get("chart") if message is not None else None
    if chart is None:
        raise NotFound()
    return charts.render(chart, theme)


def mark_delivered(message_id: int, message_ids: list[int]) -> None:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is None:
            raise NotFound()
        message.delivered_ids = message_ids
        if (message.payload or {}).get("refresh"):
            message.payload = {k: v for k, v in message.payload.items() if k != "refresh"}
        db.commit()


# ---- Taking messages and files in ---------------------------------------------------------------

def _normalise(text: str) -> str:
    return re.sub(r"[\s.!]+", " ", text.lower()).strip()


def _waiting_card(db, channel: str, seen_message_id: int | None) -> ChatProposal | None:
    """The one card a typed yes or no can mean: the only one still open that was made since the person
    last spoke, and actually shown."""
    last_said = db.query(func.max(ChatMessage.id)).filter(ChatMessage.channel == channel, ChatMessage.role == "user").scalar() or 0
    pending = (
        db.query(ChatProposal)
        .filter(ChatProposal.channel == channel, ChatProposal.status == "pending",
                ChatProposal.message_id > max(last_said, brain.conversation_start(db, channel)))
        .all()
    )
    if len(pending) != 1 or pending[0].note == _STALE_NOTE:  # a yes can't say which version it meant
        return None
    card = pending[0]
    # The reply that made the card may still be finishing its words; anything else in progress makes a yes unclear.
    working = db.query(ChatMessage.id).filter(ChatMessage.channel == channel, ChatMessage.status.in_(_IN_FLIGHT)).all()
    if any(row.id != card.message.reply_to for row in working):
        return None
    shown = card.message.delivered_ids is not None if channel == "telegram" else (seen_message_id or 0) >= card.message_id
    return card if shown else None


def submit_text(
    channel: str, text: str, choose_transaction_id: int | None = None, seen_message_id: int | None = None,
    kind: str = "text",
) -> dict:
    """Save what was said. A plain yes or no to the card in front of it is settled here and now, and so
    is asking to see all of its rows. Words heard from a voice note never settle a card: a slip of the
    ear must not apply anything."""
    with SessionLocal() as db:
        if choose_transaction_id is not None:
            chosen = db.get(Transaction, choose_transaction_id)
            if chosen is None:
                raise NotFound()
            row = actions.describe_transaction(chosen)
            text = f"That one: {row['description']}, {row['date_label']}, {row['amount_label']} (id {row['id']})"
        answer = _normalise(text)
        settles = kind == "text" and answer in _YES | _NO | _SHOW_ALL
        card = _waiting_card(db, channel, seen_message_id) if settles else None
        message = ChatMessage(
            channel=channel, role="user", kind=kind, text=text, status="done" if card else "queued",
        )
        db.add(message)
        db.commit()
        out = message_out(message)
        proposal_id = card.id if card else None
    if proposal_id is None:
        _ensure_worker()
    elif answer in _SHOW_ALL:
        show_all(proposal_id, out["id"])
    else:
        out["card"] = apply_proposal(proposal_id) if answer in _YES else reject_proposal(proposal_id)
    return out


def submit_voice(channel: str, content: bytes) -> dict:
    """A voice note: what was heard goes in as the person's message. `heard` is None when it could
    not be made out, and then nothing is saved."""
    try:
        heard = voice.transcribe(content) if len(content) <= MAX_FILE_BYTES else None
    except voice.TooLong:
        return {"heard": None, "too_long": True}
    if not heard:
        return {"heard": None}
    return {**submit_text(channel, heard, kind="voice"), "heard": heard}


def submit_photo(channel: str, content: bytes, caption: str = "") -> dict:
    """A photo, with whatever was written under it, for Claude to look at."""
    with SessionLocal() as db:
        readable = len(content) <= MAX_PICTURE_BYTES and claude_cli.picture_type(content) is not None
        message = ChatMessage(
            channel=channel, role="user", kind="photo", text=caption.strip(), status="queued" if readable else "done",
            file_content=content if readable else None,
        )
        db.add(message)
        db.commit()
        out = message_out(message)
    if readable:
        _ensure_worker()
    else:
        _say(out["id"], "error", "I could not read that picture. Send it as a photo, or type what it shows. Nothing changed.")
    return out


def show_all(proposal_id: int, reply_to: int | None = None) -> None:
    """Every row of a card, as a message in its chat."""
    with SessionLocal() as db:
        proposal = db.get(ChatProposal, proposal_id)
        if proposal is None:
            raise NotFound()
        db.add(ChatMessage(
            channel=proposal.channel, role="assistant", kind="answer", text=actions.details(proposal.preview),
            reply_to=reply_to or proposal.message.reply_to,
        ))
        db.commit()


def submit_file(channel: str, filename: str, content: bytes) -> dict:
    with SessionLocal() as db:
        message = ChatMessage(
            channel=channel, role="user", kind="file", text=filename or "bank file", status="queued",
            file_content=content,
        )
        db.add(message)
        db.commit()
        out = message_out(message)
    _ensure_worker()
    return out


def new_chat(channel: str) -> None:
    """Start the conversation afresh. What came before stays saved, but is no longer shown or remembered,
    its open suggestions are withdrawn and a reply still being worked on is stopped and never lands."""
    with SessionLocal() as db:
        db.execute(
            update(ChatMessage)
            .where(ChatMessage.channel == channel, ChatMessage.status.in_(("running", "waiting")))
            .values(status="stopping")
        )
        db.execute(
            update(ChatMessage)
            .where(ChatMessage.channel == channel, ChatMessage.status == "queued")
            .values(status="done", file_content=None)
        )
        db.execute(
            update(ChatProposal)
            .where(ChatProposal.channel == channel, ChatProposal.status == "pending", ChatProposal.op != "merge")
            .values(status="superseded")
        )
        db.add(ChatMessage(channel=channel, role="system", kind=brain.NEW_CHAT, text="", status="done"))
        db.commit()


def stop(channel: str) -> int:
    """End the reply being worked on in a chat, and anything of its waiting in line. Returns how many."""
    with SessionLocal() as db:
        working = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == channel, ChatMessage.role == "user", ChatMessage.status.in_(_IN_FLIGHT))
            .all()
        )
        queued = []
        for message in working:
            if message.status == "queued":
                message.status = "done"
                message.file_content = None
                message.payload = {**(message.payload or {}), "ended": "stopped"}
                queued.append(message.id)
            else:
                message.status = "stopping"
        db.commit()
    for message_id in queued:
        _say(message_id, "answer", _STOPPED_IN_LINE)
    return len(working)


# ---- Questions about payments Claude was not sure of ---------------------------------------------

def _question_text(group: guesses.Group) -> str:
    first = actions.describe_transaction(group.rows[0])
    if len(group.rows) == 1:
        what = f"{group.name}, {first['date_label']}, {first['amount_label']}"
    else:
        what = f"{group.name}: {len(group.rows)} payments, {actions.eur(abs(group.total_cents))} in all"
    return f"{what}. {'What was this money for?' if group.incoming else 'Where does it belong?'}"


def _open_questions(db, channel: str) -> list[ChatMessage]:
    asked = (
        db.query(ChatMessage).filter(ChatMessage.channel == channel, ChatMessage.kind == "question")
        .order_by(ChatMessage.id.desc()).limit(HISTORY_LIMIT).all()
    )
    return [m for m in asked if (m.payload or {}).get("status") == "open"]


def _refresh_questions(db, channel: str) -> None:
    """A question whose payments were sorted some other way is closed, and its message brought up to date."""
    changed = False
    for message in _open_questions(db, channel):
        rows = [db.get(Transaction, i) for i in message.payload.get("transaction_ids", [])]
        if any(t is not None and not t.confirmed for t in rows):
            continue
        went_to = {t.category.name for t in rows if t is not None and t.category is not None}
        result = f"Sorted as {went_to.pop()}." if len(went_to) == 1 else "Sorted."
        message.payload = {**message.payload, "status": "answered", "result": result,
                           **({"refresh": True} if message.delivered_ids is not None else {})}
        changed = True
    if changed:
        db.commit()


def _can_judge() -> bool:
    return bool(claude_cli.enabled() or os.getenv("ANTHROPIC_API_KEY"))


_no_answer: set[int] = set()  # payments Claude was asked about and gave no answer for, since the app started


def ask_questions(channel: str = QUESTION_CHANNEL, unasked: bool = False) -> int:
    """Put the next waiting payments to the household, a shop at a time, until enough questions are open.

    Returns how many were added. The largest amounts are asked about first. A payment Claude has not
    looked at yet is not asked about while Claude can still be asked: it may well be sure. One Claude
    gave no answer for is asked about like the rest. `unasked` marks questions nobody in the chat
    prompted, which keep the quiet hours.
    """
    with SessionLocal() as db:
        _refresh_questions(db, channel)
        open_now = _open_questions(db, channel)
        asked = {m.payload.get("key") for m in open_now}
        added = 0
        for group in guesses.groups(db, judged_only=_can_judge(), tried=_no_answer):
            if len(open_now) + added >= QUESTIONS_OPEN:
                break
            if group.key in asked:
                continue
            rows = group.rows
            db.add(ChatMessage(
                channel=channel, role="assistant", kind="question", text=_question_text(group),
                payload={
                    "status": "open", "key": group.key, "name": group.name, "incoming": group.incoming,
                    **({"unasked": True} if unasked else {}),
                    "transaction_ids": [t.id for t in rows], "count": len(rows), "total_cents": group.total_cents,
                    "examples": [
                        {k: actions.describe_transaction(t)[k] for k in ("date_label", "amount_label", "description")}
                        for t in rows[:3]
                    ],
                    "options": guesses.options_for(db, group),
                },
            ))
            added += 1
        db.commit()
        return added


def answer_question(message_id: int, option: int) -> dict:
    """A tap on one of a question's buttons: its payments are sorted, the shop remembered, and the
    next question asked."""
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is None or message.kind != "question":
            raise NotFound()
        payload = message.payload or {}
        options = payload.get("options", [])
        if payload.get("status") == "open":
            if not 0 <= option < len(options):
                raise NotFound()
            category = db.get(Category, options[option]["category_id"])
            if category is None:
                result = "That category no longer exists, so nothing was sorted. Tell me where it belongs."
            else:
                rows = [db.get(Transaction, i) for i in payload.get("transaction_ids", [])]
                done = guesses.answer(db, [t for t in rows if t is not None], category)
                count = f"{len(done)} payment{'' if len(done) == 1 else 's'}"
                if not done:
                    result = "These were already sorted."
                elif done[0].is_refund or guesses.hides_shop(guesses.shop_pattern(done[0].description)):
                    result = f"{options[option]['label']}. {count} sorted."
                else:
                    result = f"{options[option]['label']}. {count} sorted, and remembered for next time."
            message.payload = {**payload, "status": "answered", "result": result}
            db.commit()
        out, channel = message_out(message), message.channel
    ask_questions(channel)
    return out


SOMETHING_ELSE = "Tell me in a few words what {name} is, and I will sort it."


def something_else(message_id: int) -> dict:
    """A tap on a question's "Something else": the app asks what it is, as a line of the conversation, so
    that Claude knows which payment the words that follow are about."""
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is None or message.kind != "question":
            raise NotFound()
        payload = message.payload or {}
        if payload.get("status") == "open" and not payload.get("asked_what"):
            message.payload = {**payload, "asked_what": True}
            db.add(ChatMessage(
                channel=message.channel, role="assistant", kind="answer",
                text=SOMETHING_ELSE.format(name=payload.get("name") or "this"),
                payload={"about_question": message.id, "transaction_ids": payload.get("transaction_ids", [])},
            ))
            db.commit()
        return message_out(message)


def after_import(asked_in_chat: bool = False) -> None:
    """New rows are in: ask about the ones Claude was not sure of.

    A file sent in the chat was asked for there, so its questions follow at once. After an import on the
    Import page, or at startup, they are unasked messages and keep the quiet hours: at night they wait
    for the morning (nudges.tick asks them then).
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
    """Payments nobody has judged yet (those that waited from before guesses were sure-or-doubtful, or
    that an import ran out of time for): judge them now, a hundred at a time, then ask about the rest,
    those Claude could not be reached for included."""
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


# ---- Yes and No ---------------------------------------------------------------------------------

def _load_card(proposal_id: int) -> dict:
    with SessionLocal() as db:
        proposal = db.get(ChatProposal, proposal_id)
        if proposal is None:
            raise NotFound()
        return card_of(proposal)


def _settle(proposal_id: int, from_statuses: tuple[str, ...], **values) -> None:
    with SessionLocal() as db:
        db.execute(
            update(ChatProposal)
            .where(ChatProposal.id == proposal_id, ChatProposal.status.in_(from_statuses))
            .values(**values)
        )
        db.commit()


def apply_proposal(proposal_id: int, version: str | None = None) -> dict:
    """A person's Yes. Runs the change once, however many times it is tapped.

    A tap names the version it was made on; one on a version since replaced changes nothing.
    A typed yes has no version, and _waiting_card has already vouched for what it answers.
    """
    with SessionLocal() as db:
        proposal = db.get(ChatProposal, proposal_id)
        if proposal is None:
            raise NotFound()
        if proposal.status not in ("pending", "failed") or version not in (None, _version(proposal.preview)):
            return card_of(proposal)
        op, args, shown = proposal.op, proposal.args, proposal.preview

    table = ChatProposal.__table__

    def precheck(conn) -> None:
        status = conn.execute(table.select().where(table.c.id == proposal_id)).mappings().one()["status"]
        if status not in ("pending", "failed"):
            raise _AlreadySettled()

    def on_commit(conn, fresh: dict) -> None:
        conn.execute(table.update().where(table.c.id == proposal_id).values(
            status="applied", preview=fresh, error=None,
            result={"text": actions.applied_text(fresh["changes"]), "effect": fresh["effect"]},
        ))

    try:
        actions.apply(op, args, shown, on_commit, precheck)
    except _AlreadySettled:
        pass
    except actions.StaleProposal as stale:
        _settle(proposal_id, ("pending", "failed"), status="pending", preview=stale.preview, error=None,
                note=_STALE_NOTE)
    except actions.ActionError as e:
        _settle(proposal_id, ("pending", "failed"), status="failed", error=str(e))
    except Exception:
        logger.exception("[chat] applying a proposal failed")
        _settle(proposal_id, ("pending", "failed"), status="failed", error="The change could not be saved.")
    return _load_card(proposal_id)


def reject_proposal(proposal_id: int) -> dict:
    _load_card(proposal_id)
    _settle(proposal_id, ("pending", "failed"), status="rejected")
    return _load_card(proposal_id)


# ---- Working through the queue ------------------------------------------------------------------

def resume() -> None:
    """After a restart: anything half done goes back in line."""
    with SessionLocal() as db:
        db.execute(
            update(ChatMessage).where(ChatMessage.status.in_(("running", "waiting", "stopping"))).values(status="queued")
        )
        db.commit()
        waiting = db.query(ChatMessage).filter(ChatMessage.status == "queued").count()
    if waiting:
        _ensure_worker()
    if _can_judge():
        threading.Thread(target=_settle_backlog, name="settle-backlog", daemon=True).start()


def _ensure_worker() -> None:
    global _worker
    with _worker_guard:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_drain, name="chat-worker", daemon=True)
            _worker.start()


def _next_queued() -> tuple[int, str] | None:
    with SessionLocal() as db:
        message = db.query(ChatMessage).filter(ChatMessage.status == "queued").order_by(ChatMessage.id).first()
        if message is None:
            return None
        message.status = "running"
        db.commit()
        return message.id, message.kind


def _drain() -> None:
    global _worker
    while True:
        with _worker_guard:
            next_up = _next_queued()
            if next_up is None:
                _worker = None
                return
        message_id, kind = next_up
        try:
            if kind == "file":
                _handle_file(message_id)
            else:
                _handle_text(message_id)
        except Exception:
            logger.exception("[chat] handling a message failed")
            _say(message_id, "error", "Something went wrong on this side, so nothing changed.")
        _finish(message_id)


def _set_status(message_id: int, status: str) -> None:
    with SessionLocal() as db:
        db.execute(update(ChatMessage).where(ChatMessage.id == message_id).values(status=status))
        db.commit()


def _finish(message_id: int) -> None:
    with SessionLocal() as db:
        db.execute(
            update(ChatMessage).where(ChatMessage.id == message_id).values(status="done", file_content=None)
        )
        db.commit()


def _overtaken(db, asked: ChatMessage | None) -> bool:
    """The conversation it belongs to was replaced by a new chat while it was being worked out."""
    return asked is None or brain.conversation_start(db, asked.channel) > asked.id


def waiting_nudge(channel: str) -> tuple[set[str], str | None]:
    """What the app said unasked that nobody has been shown yet: which messages it holds, and its words."""
    with SessionLocal() as db:
        unshown = _unshown_nudges(db, channel)
        kinds = {kind for m in unshown for kind in ((m.payload or {}).get("nudge") or "").split("+") if kind}
        return kinds, (unshown[-1].text if len(unshown) == 1 else None)


def post_nudge(channel: str, text: str, payload: dict) -> int:
    """Say something unasked. It takes the place of whatever unasked message still waits to be shown, so
    a chat that could not be reached for a while gets one message, not a row of them. With no text, what
    waits is only taken back: it no longer holds."""
    with SessionLocal() as db:
        for earlier in _unshown_nudges(db, channel):
            db.delete(earlier)
        message = ChatMessage(channel=channel, role="assistant", kind="nudge", text=text, payload=payload)
        if text:
            db.add(message)
        db.commit()
        return message.id if text else 0


def _unshown_nudges(db, channel: str) -> list[ChatMessage]:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.channel == channel, ChatMessage.kind == "nudge", ChatMessage.delivered_ids == None)  # noqa: E711
        .order_by(ChatMessage.id).all()
    )


def _attach_to_card(message_id: int, text: str) -> bool:
    """Put Claude's words on the card it made in this reply, so the two arrive as one message."""
    with SessionLocal() as db:
        asked = db.get(ChatMessage, message_id)
        if _overtaken(db, asked):
            return True  # nobody is there to read them
        card = (
            db.query(ChatMessage)
            .filter(ChatMessage.reply_to == message_id, ChatMessage.kind == "proposal")
            .order_by(ChatMessage.id.desc()).first()
        )
        if card is None or card.proposal is None or card.proposal.status != "pending":
            return False
        card.payload = {**(card.payload or {}), "says": text,
                        **({"refresh": True} if card.delivered_ids is not None else {})}
        db.commit()
        return True


def _say(reply_to: int, kind: str, text: str, payload: dict | None = None) -> int | None:
    """Add a reply, unless a new chat was started while it was being worked out."""
    with SessionLocal() as db:
        asked = db.get(ChatMessage, reply_to)
        if _overtaken(db, asked):
            return None
        reply = ChatMessage(
            channel=asked.channel, role="assistant", kind=kind, text=text, reply_to=reply_to, payload=payload,
        )
        db.add(reply)
        db.commit()
        return reply.id


def explain_claude(error: Exception) -> str:
    detail = str(error).lower()
    if re.search(r"logged in|login|log in|authenticat|oauth|401|unauthori[sz]ed", detail):
        return "Claude is logged out on this machine, so it cannot answer until someone logs in again."
    if re.search(r"usage limit|hit your limit|limit reached|rate limit|quota|429", detail):
        return "Claude has reached its usage limit, so it cannot answer until the limit resets."
    if "not set up" in detail or "not found" in detail:
        return "Claude is not set up on this machine."
    if "stopped after" in detail:
        return "Claude took too long to answer."
    return "Claude could not be reached."


def _note_step(message_id: int, step: str) -> None:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is not None:
            payload = message.payload or {}
            message.payload = {**payload, "steps": [*payload.get("steps", []), step]}
            db.commit()


def _end_note(message_id: int, **notes) -> None:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is not None:
            message.payload = {**(message.payload or {}), **notes}
            db.commit()


def _stopping(message_id: int) -> bool:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        return message is None or message.status == "stopping" or _overtaken(db, message)


def _abandoned(message_id: int) -> bool:
    with SessionLocal() as db:
        return _overtaken(db, db.get(ChatMessage, message_id))


def _handle_text(message_id: int) -> None:
    if not claude_cli.enabled():
        _say(message_id, "error", "Claude is not set up on this machine. Nothing changed.")
        return

    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is None:
            return
        channel, text = message.channel, message.text
        picture = message.file_content if message.kind == "photo" else None
        prompt = brain.build_prompt(db, channel, message)
        recent_options: set[int] = set()  # every row offered in this run of "which one?" questions
        for earlier in reversed(brain.history_of(db, channel, message_id)):
            if earlier.kind in ("question", "nudge"):
                continue  # what the app said on its own is not part of the exchange
            options = (earlier.payload or {}).get("options") if earlier.kind == "clarify" else None
            if options:
                recent_options |= {o["id"] for o in options}
            elif earlier.role == "assistant":
                break

    def on_wait(waiting: bool) -> None:
        with SessionLocal() as db:
            db.execute(
                update(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.status != "stopping")
                .values(status="waiting" if waiting else "running")
            )
            db.commit()

    def propose(call: brain.ProposeChange) -> str | None:
        return _propose(message_id, channel, text, call, recent_options)

    try:
        reply = brain.converse(
            prompt, on_wait, lambda step: _note_step(message_id, step), propose, lambda: _stopping(message_id),
            abandoned=lambda: _abandoned(message_id), picture=picture,
        )
    except claude_cli.ClaudeCliError as e:
        logger.warning("[chat] Claude failed: %s", e)
        _say(message_id, "error", f"{explain_claude(e)} Nothing changed.")
        return
    except brain.UnreadableReply:
        _say(message_id, "error", "Claude's answer came back empty, so nothing changed. Try saying it another way.")
        return

    _end_note(message_id, lookups=reply.lookups, **({"ended": reply.ended} if reply.ended else {}))
    if reply.choices:
        with SessionLocal() as db:
            rows = [db.get(Transaction, tx_id) for tx_id in reply.choices]
            options = [actions.describe_transaction(t) for t in rows if t is not None]
        _say(message_id, "clarify", reply.text or "Which one do you mean?", {"options": options})
    elif reply.text:
        if reply.cards and not reply.chart and not reply.ended and _attach_to_card(message_id, reply.text):
            return
        _say(message_id, "answer", reply.text, {"chart": reply.chart} if reply.chart else None)


def _names_date(text: str, tx: Transaction) -> bool:
    day, month = tx.date.day, tx.date.month
    english = tx.date.strftime("%b").lower()
    dutch = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][month - 1]
    lowered = text.lower()
    patterns = [
        rf"\b{day}(st|nd|rd|th)?\s*(of\s+)?({english}|{dutch})", rf"\b({english}|{dutch})[a-z]*\s+{day}\b",
        rf"\b0?{day}[-/.]0?{month}\b", tx.date.isoformat(),
    ]
    return any(re.search(p, lowered) for p in patterns)


def _shop(description: str) -> tuple[str, ...]:
    return tuple(re.sub(r"[^a-z]+", " ", description.lower()).split()[:2])


def _lookalikes(db, target: Transaction, text: str, chosen_from: set[int]) -> list[Transaction]:
    """Other rows the same message could equally mean. Empty if the person already settled which."""
    if target.id in chosen_from or _names_date(text, target):
        return []
    twins = db.query(Transaction).filter(
        Transaction.amount == target.amount, Transaction.id != target.id,
    ).all()
    return [t for t in twins if _shop(t.description) == _shop(target.description)]


_TARGET_KEYS = {
    "transaction.update": ["id"], "transaction.split": ["id"], "transaction.delete": ["id"],
    "refund.book": ["refund_id", "purchase_id"], "refund.add": ["purchase_id"], "set_aside.pay": ["transaction_id"],
}


def _propose(message_id: int, channel: str, text: str, call: brain.ProposeChange, chosen_from: set[int]) -> str | None:
    """Turn a suggested change into a card, or say why the app won't take it, for Claude to put right."""
    if call.op not in actions.OPS:
        return f"there is no change called '{call.op}'"
    with SessionLocal() as db:
        for key in _TARGET_KEYS.get(call.op, []):
            target = db.get(Transaction, call.args.get(key)) if isinstance(call.args.get(key), int) else None
            if target is None:
                continue
            twins = _lookalikes(db, target, text, chosen_from)
            if twins:
                rows = ", ".join(
                    f"id {t.id} on {t.date.isoformat()}" for t in sorted([target, *twins], key=lambda t: t.date)
                )
                return (
                    f"more than one payment looks like the one you picked ({rows}), and the person has not said which. "
                    "Ask them, with show_choices."
                )
    try:
        preview = actions.preview(call.op, call.args)
    except actions.ActionError as e:
        return str(e)
    except Exception:
        logger.exception("[chat] previewing a change failed")
        return "the app could not work out what this would change"
    with SessionLocal() as db:
        open_cards = (
            db.query(ChatProposal)
            .filter(ChatProposal.channel == channel, ChatProposal.status == "pending", ChatProposal.op == call.op)
            .all()
        )
        said = json.dumps(preview, sort_keys=True, default=str)
        if any(
            card.id not in call.replaces and card.args == call.args
            and json.dumps(card.preview, sort_keys=True, default=str) == said
            for card in open_cards
        ):
            return "a card for exactly this change is already open, so it was not made a second time. Point the person to that card"
    if not _save_proposal(message_id, channel, call.op, call.args, call.summary, call.note, preview, replaces=call.replaces):
        return "the conversation moved on, so this card was not shown"
    return None


def _save_proposal(
    message_id: int, channel: str, op: str, args: dict, summary: str, note: str | None, preview: dict,
    replaces: list[int] = (),
) -> bool:
    """Show a card. The open cards it replaces are withdrawn; every other card stays as it is."""
    with SessionLocal() as db:
        if _overtaken(db, db.get(ChatMessage, message_id)):
            return False
        if replaces:
            db.execute(
                update(ChatProposal)
                .where(ChatProposal.channel == channel, ChatProposal.status.in_(("pending", "failed")),
                       ChatProposal.id.in_(list(replaces)))
                .values(status="superseded")
            )
        message = ChatMessage(channel=channel, role="assistant", kind="proposal", text=summary, reply_to=message_id)
        message.proposal = ChatProposal(
            channel=channel, op=op, args=args, summary=summary, note=note, preview=preview,
        )
        db.add(message)
        db.commit()
        return True


# ---- Files --------------------------------------------------------------------------------------

def _merge_offers(new_transactions: list[Transaction], db) -> list[tuple[dict, str]]:
    offers = []
    for manual, bank in import_service.double_entries(new_transactions, db):
        label = "refund" if manual.is_refund else "entry"
        offers.append(({"manual_id": manual.id, "bank_id": bank.id}, (
            f"The manual {actions.describe_transaction(manual)['amount_label']} {label} matches the "
            f"bank row from {actions.describe_transaction(bank)['date_label']}."
        )))
    return offers


def _handle_file(message_id: int) -> None:
    with SessionLocal() as db:
        message = db.get(ChatMessage, message_id)
        if message is None:
            return
        channel, content = message.channel, message.file_content or b""

    if len(content) > MAX_FILE_BYTES:
        _say(message_id, "error", "That file could not be used because it is too large. Nothing was imported.")
        return
    try:
        rows = parse_ing(content)
    except BadFile as e:
        _say(message_id, "error", f"That file could not be used because {e}. {ONLY_ING} Nothing was imported.")
        return

    with SessionLocal() as db:
        try:
            outcome = import_service.import_rows(rows, db, cli_only=True)
        except claude_cli.ClaudeCliError as e:
            db.rollback()
            logger.warning("[chat] Claude failed during an import: %s", e)
            _say(message_id, "error", f"{explain_claude(e)} Nothing was imported. Send the file again once that is sorted.")
            return
        # The rows are saved from here on, so a failure must not end in "nothing changed".
        merge_check_failed = False
        try:
            offers = _merge_offers(outcome.new_transactions, db)
        except Exception:
            logger.exception("[chat] looking for double entries failed")
            offers, merge_check_failed = [], True

    counts = {
        "imported": outcome.imported, "skipped": outcome.skipped, "by_rule": outcome.by_rule,
        "by_ai": outcome.by_ai, "doubtful": outcome.doubtful, "uncategorised": outcome.uncategorised,
    }
    _say(message_id, "import", (
        f"Imported {outcome.imported} new, skipped {outcome.skipped} already here. "
        f"{outcome.by_rule + outcome.by_ai} sorted and counted ({outcome.by_rule} by rules, {outcome.by_ai} Claude was sure of), "
        f"{outcome.doubtful + outcome.uncategorised} waiting for an answer."
    ), counts)
    after_import(asked_in_chat=True)

    for args, description in offers:
        try:
            preview = actions.preview("merge", args)
            _save_proposal(message_id, channel, "merge", args, description, None, preview)
        except Exception:
            logger.exception("[chat] could not offer a merge")
            merge_check_failed = True
    if merge_check_failed:
        _say(message_id, "error", _MERGE_CHECK_FAILED)
