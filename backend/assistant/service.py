"""The conversation: saving messages, working through them one at a time, and Yes or No."""
import csv
import hashlib
import io
import json
import logging
import re
import threading
from datetime import datetime, timezone
from decimal import InvalidOperation

from sqlalchemy import func, update

import import_service
from assistant import actions, brain, charts
from categorizer import claude_cli
from db import SessionLocal
from importers.ing import INGImporter
from models import CategorisedBy, ChatMessage, ChatProposal, Transaction

logger = logging.getLogger(__name__)

CHANNELS = ("bubble", "telegram")
HISTORY_LIMIT = 400
MAX_FILE_BYTES = 10 * 1024 * 1024
_IN_FLIGHT = ("queued", "running", "waiting", "stopping")
_STOPPED_IN_LINE = "Stopped before I started on that. Nothing changed."
_ING_HEADERS = ("Date", "Name / Description", "Amount (EUR)", "Debit/credit")
_ING_AMOUNT = re.compile(r"\d+([.,]\d{1,2})?")
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
    return {
        "id": proposal.id,
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
        guesses = db.query(func.count(Transaction.id)).filter(
            Transaction.confirmed == False, Transaction.categorised_by == CategorisedBy.ai,  # noqa: E712
        ).scalar()
        return {
            "messages": [message_out(m) for m in reversed(rows)],
            "guesses_waiting": guesses,
            "claude_busy": claude_cli.busy(),
        }


def outbox(channel: str) -> dict:
    """What a chat that pushes to its reader still has to show, and what is still being worked on."""
    with SessionLocal() as db:
        replies = (
            db.query(ChatMessage)
            .filter(ChatMessage.channel == channel, ChatMessage.role == "assistant", ChatMessage.delivered_ids == None)  # noqa: E711
            .order_by(ChatMessage.id).all()
        )
        working = (
            db.query(ChatMessage).filter(ChatMessage.channel == channel, ChatMessage.status.in_(_IN_FLIGHT))
            .order_by(ChatMessage.id).all()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        return {
            "replies": [message_out(r) for r in replies],
            "in_flight": [
                {"id": m.id, "kind": m.kind, "status": m.status, "age_seconds": (now - m.created_at.replace(tzinfo=None)).total_seconds(),
                 "steps": (m.payload or {}).get("steps", [])}
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
) -> dict:
    """Save what was said. A plain yes or no to the card in front of it is settled here and now."""
    with SessionLocal() as db:
        if choose_transaction_id is not None:
            chosen = db.get(Transaction, choose_transaction_id)
            if chosen is None:
                raise NotFound()
            row = actions.describe_transaction(chosen)
            text = f"That one: {row['description']}, {row['date_label']}, {row['amount_label']} (id {row['id']})"
        answer = _normalise(text)
        card = _waiting_card(db, channel, seen_message_id) if answer in _YES | _NO else None
        message = ChatMessage(
            channel=channel, role="user", kind="text", text=text, status="done" if card else "queued",
        )
        db.add(message)
        db.commit()
        out = message_out(message)
        proposal_id = card.id if card else None
    if proposal_id is not None:
        out["card"] = apply_proposal(proposal_id) if answer in _YES else reject_proposal(proposal_id)
    else:
        _ensure_worker()
    return out


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
        prompt = brain.build_prompt(db, channel, message)
        recent_options: set[int] = set()  # every row offered in this run of "which one?" questions
        for earlier in reversed(brain.history_of(db, channel, message_id)):
            options = (earlier.payload or {}).get("options") if earlier.role == "assistant" else None
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
            abandoned=lambda: _abandoned(message_id),
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
    "transaction.rule": ["id"], "refund.book": ["refund_id", "purchase_id"], "refund.add": ["purchase_id"],
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

class _BadFile(Exception):
    pass


def parse_ing_file(content: bytes) -> list:
    """The file's rows, or _BadFile if it is not an ING CSV with at least one row."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _BadFile("it is not a text file") from None
    try:
        headers = next(csv.reader(io.StringIO(text), delimiter=";"), [])
        names = {h.strip().strip('"') for h in headers}
        if not all(h in names for h in _ING_HEADERS):
            raise _BadFile("it does not have the columns of an ING export")
        for row in csv.DictReader(io.StringIO(text), delimiter=";"):
            if not (row.get("Date") or "").strip():
                if any(isinstance(v, str) and v.strip() for v in row.values()):
                    raise _BadFile("some of its rows could not be read")
                continue
            direction = (row.get("Debit/credit") or "").strip().lower()
            if direction not in ("debit", "credit") or not _ING_AMOUNT.fullmatch((row.get("Amount (EUR)") or "").strip()):
                raise _BadFile("some of its rows could not be read")
        rows = INGImporter().parse(io.StringIO(text))
    except (ValueError, KeyError, AttributeError, TypeError, InvalidOperation, csv.Error):
        raise _BadFile("some of its rows could not be read") from None
    if not rows:
        raise _BadFile("it has no transactions in it")
    return rows


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
        rows = parse_ing_file(content)
    except _BadFile as e:
        _say(message_id, "error", f"That file could not be used because {e}. Nothing was imported.")
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
        "by_ai": outcome.by_ai, "uncategorised": outcome.uncategorised,
    }
    _say(message_id, "import", (
        f"Imported {outcome.imported} new, skipped {outcome.skipped} already here, "
        f"{outcome.by_rule} sorted by rules, {outcome.by_ai} guesses to review, "
        f"{outcome.uncategorised} could not be sorted."
    ), counts)

    for args, description in offers:
        try:
            preview = actions.preview("merge", args)
            _save_proposal(message_id, channel, "merge", args, description, None, preview)
        except Exception:
            logger.exception("[chat] could not offer a merge")
            merge_check_failed = True
    if merge_check_failed:
        _say(message_id, "error", _MERGE_CHECK_FAILED)
