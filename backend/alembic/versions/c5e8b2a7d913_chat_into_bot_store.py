"""The chat moves to the shared bot kit: its history is copied into the kit's own SQLite file, then dropped here.

Copies every row of chat_messages and chat_proposals into the bot kit's store (BOT_DB_PATH, else bot.db beside
this database; botkit SPEC §8) and then drops the two tables, all in this one revision, so the copy cannot be
skipped: the tables only go once the copy is in the store. Message and card ids are kept, so Telegram's delivered
message ids, questions and cards still line up. Each channel's history is split into conversations at its New chat
markers, the way the kit keeps them.

The copy runs once. It is one transaction in the store that also writes a marker (`bot_meta`
`copied_from_finance_chat`); if this revision is run again after the copy landed but before the tables were dropped
(a crash in between), the marker says it is done and only the drop is left, unless the old tables have rows the
copy did not see, in which case it stops rather than lose them. It also refuses to copy into a store that already
holds messages.

Downgrade puts back the two (empty) tables; what was said stays in the bot store.

Revision ID: c5e8b2a7d913
Revises: a6d1e4f8c203
"""
import json
import os
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "c5e8b2a7d913"
down_revision = "a6d1e4f8c203"
branch_labels = None
depends_on = None

MARK = "copied_from_finance_chat"
KINDS = {"proposal": "card", "clarify": "answer"}
CARD_STATUS = {"pending": "open"}


def _iso(value) -> str:
    """An old naive-UTC timestamp as the kit writes times: ISO 8601, UTC, milliseconds, Z."""
    if value is None:
        moment = datetime.now(timezone.utc)
    elif isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    else:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        moment = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json(value):
    if value is None or isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _kind(row, payload: dict) -> str:
    """The kit's kind: a card is `card`, "which one?" an answer with options, every row of a card `all_rows`."""
    if row.kind == "answer" and payload.get("groups"):
        return "all_rows"
    return KINDS.get(row.kind, row.kind)


def _message_payload(row, payload: dict) -> tuple[dict, list]:
    """The old payload in the kit's shape, and the live log, which the kit keeps in its own column."""
    from assistant import questions  # pure helpers; the bot itself is not started here

    payload = dict(payload or {})
    steps = list(payload.pop("steps", None) or [])
    kind = row.kind
    if kind == "clarify":
        payload["options"] = [
            {"id": o["id"], "label": o.get("description", ""),
             "detail": f"{o.get('date_label', '')} · {o.get('amount_label', '')}"}
            for o in payload.get("options") or []
        ]
    elif kind == "question":
        payload["buttons"] = questions.question_buttons(payload)
    elif kind == "file" and row.role == "user":
        payload.setdefault("filename", row.text)
    if payload.get("chart") and not payload.get("image"):
        payload["image"] = {"alt": f"{payload['chart'].get('title') or 'Chart'}. The figures are in the answer above."}
    return payload, steps


def _card(row, message_payload: dict) -> tuple[dict, dict | None]:
    """A card's preview and result in the shape finance's bot gives them (assistant/bot.py)."""
    from assistant import actions
    from assistant.bot import card_preview

    preview = card_preview(_json(row.preview)).as_json()
    old = _json(row.result)
    if old is None:
        return preview, None
    result = {k: v for k, v in old.items() if k not in ("text", "remembered")}
    if "text" in old:
        result["applied_text"] = old["text"]
    if "effect" in old:
        result["effect_lines"] = actions.plain_effect(old["effect"], True)
    if old.get("remembered"):
        message_payload["remembered"] = old["remembered"]
    return preview, result


def _store_path(bind):
    from db import bot_store_path

    return bot_store_path(bind.engine.url.database)


def _copy(bind) -> None:
    from botkit.changes import version_of
    from botkit.store import Store

    messages = bind.execute(sa.text(
        "SELECT id, channel, role, kind, text, status, reply_to, payload, file_content, delivered_ids, created_at"
        " FROM chat_messages ORDER BY id"
    )).fetchall()
    proposals = bind.execute(sa.text(
        "SELECT id, channel, message_id, op, args, summary, note, preview, status, result, error FROM chat_proposals"
        " ORDER BY id"
    )).fetchall()
    newest = max((m.id for m in messages), default=0)
    path = _store_path(bind)
    store = Store(path)  # creates the kit's schema; no worker runs here
    runner, model = "claude-cli", os.getenv("CHAT_MODEL", "sonnet")
    with store.write() as kit:
        marked = kit.execute("SELECT value FROM bot_meta WHERE key = ?", (MARK,)).fetchone()
        if marked is not None:
            done = json.loads(marked["value"])
            if newest > done.get("newest_message_id", 0):
                raise RuntimeError(
                    f"{path} already holds a copy of the chat, but chat_messages has newer rows (up to id {newest}) "
                    f"than were copied (up to id {done.get('newest_message_id')}). Nothing was dropped."
                )
            return
        if kit.execute("SELECT COUNT(*) FROM bot_messages").fetchone()[0]:
            raise RuntimeError(f"{path} already holds chat messages, so the old chat was not copied into it. "
                               "Nothing was dropped.")
        current: dict[str, int] = {}  # channel -> its conversation being filled
        conversation_of: dict[int, int] = {}
        payloads: dict[int, dict] = {}
        created: dict[int, str] = {}

        def start(channel: str, at: str) -> int:
            cursor = kit.execute(
                "INSERT INTO bot_conversations (channel, runner, model, created_at) VALUES (?, ?, ?, ?)",
                (channel, runner, model, at))
            current[channel] = cursor.lastrowid
            return cursor.lastrowid

        for row in messages:
            at = _iso(row.created_at)
            conversation = current.get(row.channel) or start(row.channel, at)
            payload, steps = _message_payload(row, _json(row.payload))
            payloads[row.id], conversation_of[row.id], created[row.id] = payload, conversation, at
            kit.execute(
                "INSERT INTO bot_messages (id, conversation_id, channel, role, kind, text, status, reply_to, payload,"
                " steps, delivered, attachment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row.id, conversation, row.channel, row.role, _kind(row, payload), row.text or "",
                 row.status or "done", row.reply_to, _dumps(payload), _dumps(steps),
                 _dumps(_json(row.delivered_ids)) if row.delivered_ids is not None else None, row.file_content, at),
            )
            if row.kind == "new_chat":  # the marker closes its conversation; what follows starts the next one
                start(row.channel, at)

        for row in proposals:
            preview, result = _card(row, payloads[row.message_id])
            status = CARD_STATUS.get(row.status, row.status)
            at = created[row.message_id]
            kit.execute(
                "INSERT INTO bot_cards (id, message_id, conversation_id, channel, kind, summary, note, args, preview,"
                " version, status, result, error, created_at, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,"
                " ?, ?, ?)",
                (row.id, row.message_id, conversation_of[row.message_id], row.channel, row.op, row.summary, row.note,
                 _dumps(_json(row.args)), _dumps(preview), version_of(preview), status,
                 _dumps(result) if result is not None else None, row.error, at, None if status == "open" else at),
            )
        for message_id, payload in payloads.items():  # a remembered shop now lives on the card's message
            if payload.get("remembered"):
                kit.execute("UPDATE bot_messages SET payload = ? WHERE id = ?", (_dumps(payload), message_id))

        copied = kit.execute("SELECT COUNT(*) FROM bot_messages").fetchone()[0]
        cards = kit.execute("SELECT COUNT(*) FROM bot_cards").fetchone()[0]
        if copied != len(messages) or cards != len(proposals):
            raise RuntimeError(f"the copy came out at {copied} messages and {cards} cards, not {len(messages)} and "
                               f"{len(proposals)}. Nothing was dropped.")
        kit.execute("INSERT INTO bot_meta (key, value) VALUES (?, ?)", (MARK, _dumps({
            "messages": len(messages), "cards": len(proposals), "newest_message_id": newest,
            "at": _iso(None), "from": str(bind.engine.url.database),
        })))


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "chat_messages" in tables:
        if "chat_proposals" not in tables:
            raise RuntimeError("chat_messages is here without chat_proposals; check the database before migrating.")
        _copy(bind)
    if "chat_proposals" in tables:
        op.drop_table("chat_proposals")
    if "chat_messages" in tables:
        op.drop_table("chat_messages")


def downgrade() -> None:
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="done"),
        sa.Column("reply_to", sa.Integer(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("file_content", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("delivered_ids", sa.JSON(), nullable=True),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_chat_messages_channel", "chat_messages", ["channel", "id"])
    op.create_index("ix_chat_messages_status", "chat_messages", ["status"])
    op.create_table(
        "chat_proposals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("op", sa.String(), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_chat_proposals_channel_status", "chat_proposals", ["channel", "status"])
