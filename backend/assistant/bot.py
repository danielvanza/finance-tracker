"""The household's chat, on the shared bot kit (`botkit`, see the kit's SPEC.md).

The kit does the conversation: the queue, the live log, Stop and the time limit with its write-up, New chat, the
runner picker, cards (Apply once, stale cards shown again), the HTTP API (mounted at /api/chat) and the default
bubble. This module is what is finance's own:

- the instructions (assistant/prompts.py) and the context: today, how many payments wait, this month as the Month
  page shows it;
- the tools: month_overview, run_query (read-only, on a private in-memory copy built per reply and closed after it)
  and show_chart (a chart drawn under the reply);
- every change in assistant/actions.py as a card kind: previewed and applied by the app's own router code, with
  finance's card extras in the card's `data` and `result` (see docs/bot.md); and `merge`, offered by an import only;
- the handlers for a bank file (imported in the chat, refused whole when Claude cannot sort it), a photo (shown to
  the model as a picture) and a voice note (heard on this machine first; its words never settle a card);
- the buttons: a question's answers, Something else, Remember … for next time (assistant/questions.py), and a
  card's Show all and Remember these shops;
- how each of finance's messages appears in the conversation Claude is given, the starter buttons, the chart
  pictures, and the quiet hours.
"""
import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta

from sqlalchemy import func

import clock
import guesses
import import_service
import voice
from assistant import actions, charts, queries, questions
from assistant.prompts import SYSTEM_PROMPT, WRAP_UP
from botkit import (
    ActionContext, Applied, Bot, ChangeContext, ChangeError, ChangeKind, Ctx, Incoming, Preview, Stale, Tool, ToModel,
    ToolContext,
)
from categorizer import claude_cli
from db import SessionLocal, bot_store_path
from importers.ing import BadFile, parse_ing
from models import Transaction

logger = logging.getLogger(__name__)

CHANNELS = ("bubble", "telegram")
TIME_LIMIT_SECONDS = float(os.getenv("CHAT_TIME_LIMIT_SECONDS", "540"))  # Claude's own work on one reply
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PICTURE_BYTES = 8 * 1024 * 1024
ONLY_ING = "I can only read an ING export: a CSV file from ING, with English or Dutch column names."
MERGE_CHECK_FAILED = (
    "The import is saved. The check for payments entered twice did not finish, "
    "so a manual entry may now be counted twice."
)
UNREADABLE_PICTURE = "I could not read that picture. Send it as a photo, or type what it shows. Nothing changed."
UNHEARD = "I could not make that out. Could you say it again, or type it? Nothing changed."
TOO_LONG = "That voice note is too long for me. Keep it under two minutes, or type it. Nothing changed."
SHOW_ALL_WORDS = {
    "show all", "show everything", "show them all", "show all rows", "show the rows", "all rows", "list them",
    "list them all", "list all", "show me all", "show me everything",
}
MERGE_LABELS = {"heading": "Looks like the same payment", "apply": "Merge", "reject": "Keep both", "rejected": "Kept both. Nothing changed."}


# ---- The tools ------------------------------------------------------------------------------------

_MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
DOING = {"type": "string", "description": (
    "What you are doing, in a few plain words the person sees in the live log, such as "
    "'Checking groceries over the last six months'. No query text, table or column names."
)}


def _month_overview(args: dict, ctx: ToolContext):
    try:
        return json.dumps(queries.month_overview(args.get("month")), ensure_ascii=False)
    except Exception:
        logger.exception("[chat] reading a month failed")
        return "This lookup failed, so there are no figures from it. Say so plainly rather than guess.", True


def _for_claude(result: dict) -> dict:
    if "rows" not in result:
        return result
    labelled = [[f"r{i}", *row] for i, row in enumerate(result["rows"], 1)]
    return {**result, "columns": ["row", *result["columns"]], "rows": labelled}


def _views(ctx: ToolContext) -> queries.Views:
    """This reply's private copy of the ledger, built on its first query and closed when the reply ends."""
    views = ctx.state.get("views")
    if views is None:
        views = queries.Views()
        ctx.state["views"] = views
        ctx.on_close(views.close)
    return views


def _run_query(args: dict, ctx: ToolContext):
    try:
        views = _views(ctx)
    except Exception:
        logger.exception("[chat] preparing the history failed")
        return "The history could not be read, so there are no figures from it. Say so plainly rather than guess.", True
    results = ctx.state.setdefault("results", [])
    fresh = [views.run(f"q{len(results) + i + 1}", sql) for i, sql in enumerate(args["queries"])]
    results += fresh
    return json.dumps({"coverage": views.coverage_note(), "results": [_for_claude(r) for r in fresh]},
                      ensure_ascii=False)


def _show_chart(args: dict, ctx: ToolContext):
    spec = {key: args.get(key) for key in ("query", "type", "x", "y", "series")}
    spec["title"] = args.get("title") or ""
    try:
        chart = charts.prepare(spec, ctx.state.get("results", []))
        if chart is None:
            return "There is only one number there, so say it rather than draw it.", True
        charts.render(chart)  # proves it can be drawn before the words promise it
    except charts.ChartProblem as e:
        return f"That chart cannot be drawn: {e}.", True
    except Exception as e:  # whatever goes wrong with a picture, the words still go out
        logger.warning("[chat] a chart could not be made: %s", type(e).__name__)
        return "That chart could not be drawn. Leave it out and say so in a few words.", True
    # The last chart asked for in a reply is the one shown.
    ctx.attach(chart=chart, image={"alt": f"{chart['title'] or 'Chart'}. The figures are in the answer above."})
    return "The chart will be shown under your reply."


TOOLS = [
    Tool("month_overview", (
        "One financial month exactly as the Month page shows it: what is free to spend until payday and per day, the "
        "fixed bills still to come and set-asides it allows for, against plan by now, needs, wants and savings, and "
        "each budget category spent against planned, with category ids. Use it for any "
        "question about how a month stands; its figures are the ones people compare with the page."
    ), {
        "type": "object",
        "properties": {
            "doing": DOING,
            "month": {"type": ["string", "null"], "pattern": _MONTH,
                      "description": "YYYY-MM, or leave out for the current financial month."},
        },
        "required": ["doing"],
    }, _month_overview, step="Looking at the month"),
    Tool("run_query", (
        "Read anything in the household's finances with read-only SQLite SELECTs, as often as you need: history, "
        "single rows and their ids, payments waiting for an answer, plans, rules, set-asides and savings goals. "
        f"Each result has at most {queries.ROW_CAP} rows; one marked cut_off is incomplete, so narrow it with WHERE, "
        "GROUP BY, LIMIT and OFFSET. Work sums, differences and averages out in SQL. Name numeric columns for their "
        "unit: *_cents, *_eur, *_pct or *_count. Every response also says where the data has gaps. Nothing can be "
        "changed through this tool and these are the only tables:\n" + queries.SCHEMA
    ), {
        "type": "object",
        "properties": {
            "doing": DOING,
            "queries": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3,
                        "description": "One to three SQLite SELECT statements."},
        },
        "required": ["doing", "queries"],
    }, _run_query, step="Looking through the history"),
    Tool("show_chart", (
        "Show a chart under your reply, drawn by the app from one run_query result. Use it when a picture helps, and "
        "always when the person asks to see, show, chart, plot or graph something. Quote the same figures in your "
        "words. The last chart you ask for in a reply is the one shown."
    ), {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The id of a run_query result to draw, such as q3."},
            "type": {"type": "string", "enum": ["line", "bars"]},
            "x": {"type": "string", "description": "Column for the x axis, usually month."},
            "y": {"type": "string", "description": "Numeric column to draw, ending in _cents, _eur, _pct or _count."},
            "series": {"type": ["string", "null"],
                       "description": "Column that splits the lines or bars, such as category."},
            "title": {"type": "string", "description": "Plain words, no figures."},
        },
        "required": ["query", "type", "x", "y"],
    }, _show_chart, step="Drawing a chart"),
]


# ---- Cards ----------------------------------------------------------------------------------------

def card_preview(raw: dict) -> Preview:
    """A card from the app's own preview (changes, purchase, budget effect): its lines in the app's words, and
    everything a chat needs to show it in `data` (docs/bot.md)."""
    plain = actions.plain(raw)
    effect = raw.get("effect", [])
    return Preview(lines=plain["lines"], data={
        "changes": raw["changes"],
        "purchase": raw.get("purchase"),
        "effect": effect,
        "effect_lines": actions.plain_effect(effect, False),
        "summed_up": plain["summed_up"],
        "rows": plain["rows"],
        "payments": plain["payments"],
        # For a chat that keeps a long card short: its count, its lines without the shops, and one sentence for
        # once it is applied.
        "head": plain.get("head"),
        "short_lines": plain.get("short_lines"),
        "applied_line": plain.get("applied_line"),
    })


def applied_result(fresh: dict) -> dict:
    """What an applied card says besides its lines: what was saved, its budget effect as it stands now, and (added
    by `_after_apply`) how many payments still wait and the offer to remember the shops it sorted."""
    return {
        "applied_text": actions.applied_text(fresh["changes"]),
        "effect": fresh["effect"],
        "effect_lines": actions.plain_effect(fresh["effect"], True),
    }


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


_TARGET_KEYS = {
    "transaction.update": ["id"], "transaction.split": ["id"], "transaction.delete": ["id"],
    "refund.book": ["refund_id", "purchase_id"], "refund.add": ["purchase_id"], "set_aside.pay": ["transaction_id"],
}


def _asked(ctx: ChangeContext) -> tuple[str, set]:
    """What the person said that asked for a change, and every payment offered in the run of "which one?" answers
    just before it (a payment chosen from those is settled)."""
    store = bot().store
    with store.connect() as db:
        said = store.message(ctx.message_id, db) if ctx.message_id else None
        earlier = db.execute(
            "SELECT role, kind, payload FROM bot_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 400",
            (ctx.conversation_id, ctx.message_id or 0),
        ).fetchall()
    chosen_from: set = set()
    for row in earlier:
        if row["kind"] in ("question", "nudge", "reminder", "new_chat"):
            continue  # what the app said on its own is not part of the exchange
        options = json.loads(row["payload"] or "{}").get("options") if row["kind"] == "answer" else None
        if row["role"] == "assistant" and options:
            chosen_from |= {o["id"] for o in options}
        elif row["role"] == "assistant":
            break
    return (said or {}).get("text") or "", chosen_from


def _check_target(name: str, args: dict, ctx: ChangeContext) -> None:
    """A change aimed at a payment that looks just like another, when the person has not said which, is refused,
    so that Claude asks."""
    keys = _TARGET_KEYS.get(name)
    if not keys or ctx.message_id is None:
        return
    text, chosen_from = _asked(ctx)
    with SessionLocal() as db:
        for key in keys:
            target = db.get(Transaction, args.get(key)) if isinstance(args.get(key), int) else None
            if target is None or target.id in chosen_from or _names_date(text, target):
                continue
            twins = [t for t in db.query(Transaction).filter(Transaction.amount == target.amount,
                                                             Transaction.id != target.id).all()
                     if _shop(t.description) == _shop(target.description)]
            if twins:
                rows = ", ".join(f"id {t.id} on {t.date.isoformat()}" for t in sorted([target, *twins], key=lambda t: t.date))
                raise ChangeError(
                    f"more than one payment looks like the one you picked ({rows}), and the person has not said which. "
                    "Ask them, with show_choices."
                )


def _after_apply(fresh: dict) -> dict:
    """How many payments wait now, when the card sorted waiting ones, and the offer to remember the shops it sorted."""
    extra: dict = {}
    with SessionLocal() as db:
        sorts = [c for c in fresh["changes"] if c.get("payment") and c["payment"]["how"] in ("moved", "confirmed")]
        if any(c["title"].startswith("Removed category: ") for c in fresh["changes"]):
            sorts = []  # a category merged away moved its payments; that is no sorting to remember
        if any(f["label"] == "Reviewed" for c in sorts for f in c["fields"]):
            extra["waiting"] = db.query(func.count(Transaction.id)).filter(Transaction.confirmed == False).scalar()  # noqa: E712
        rows = [t for t in (db.get(Transaction, c["payment"]["id"]) for c in sorts) if t is not None and t.confirmed]
        shops = guesses.to_remember(db, rows)
        if shops:
            extra["offer"] = {"transaction_ids": [t.id for t in shops], "label": questions._remember_label(shops)}
    return extra


def _change_kind(name: str, signature: str, *, for_model: bool = True) -> ChangeKind:
    def preview(args: dict, ctx: ChangeContext) -> Preview:
        _check_target(name, args, ctx)
        try:
            return card_preview(actions.preview(name, args))
        except actions.ActionError as e:
            raise ChangeError(str(e)) from None

    def apply(args: dict, shown: Preview, ctx: ChangeContext) -> Applied:
        try:
            fresh = actions.apply(name, args, {"changes": shown.data["changes"]}, lambda conn, fresh: None, None,
                                  card_id=ctx.card_id)
        except actions.StaleProposal as stale:
            raise Stale(card_preview(stale.preview)) from None
        except actions.ActionError as e:
            raise ChangeError(str(e)) from None
        result = applied_result(fresh)
        if ctx.card_id is not None:  # what it changed is kept, so its Undo button can put it back until then
            result["undo_until"] = (clock.now() + timedelta(days=actions.UNDO_DAYS)).isoformat(timespec="seconds")
        try:
            result.update(_after_apply(fresh))
        except Exception:
            logger.exception("[chat] working out what an applied card still says failed")
        try:
            _mark_undone(_undone_cards(name, args))
        except Exception:
            logger.exception("[chat] marking an undone card failed")
        return Applied(result=result)

    merge = name == "merge"
    return ChangeKind(
        name=name, mode="card", signature=signature, preview=preview, apply=apply,
        labels=MERGE_LABELS if merge else {"heading": ""}, for_model=for_model, keep_on_new_chat=merge,
        buttons=card_buttons,
    )


def _undone_cards(name: str, args: dict) -> list[int]:
    """The cards an applied card.undo (or a batch holding some) put back."""
    if name == "card.undo":
        return [args["card_id"]]
    if name == "batch":
        return [c["args"]["card_id"] for c in args.get("changes", []) if c.get("op") == "card.undo"]
    return []


def _mark_undone(card_ids: list[int]) -> None:
    """An undone card's message says so (`payload.undone`), which takes its Undo button away, also in Telegram."""
    if not card_ids:
        return
    store = bot().store
    with store.write() as db:
        for card_id in card_ids:
            row = db.execute("SELECT message_id FROM bot_cards WHERE id = ?", (card_id,)).fetchone()
            if row is not None:
                store.merge_payload(db, row["message_id"], undone=True)


def _can_undo(card: dict, message: dict) -> bool:
    """An applied card whose changes were kept, not undone yet, applied less than UNDO_DAYS ago."""
    until = (card.get("result") or {}).get("undo_until")
    if card.get("status") != "applied" or not until or (message.get("payload") or {}).get("undone"):
        return False
    return clock.now() < datetime.fromisoformat(until)


def card_buttons(card: dict, message: dict) -> list[dict]:
    """A summed-up card offers every row (the bubble folds them out itself, so only push chats get the button); an
    applied card that sorted shops offers to remember them, until that is done, and for a week offers Undo."""
    data = (card.get("preview") or {}).get("data") or {}
    result = card.get("result") or {}
    if card["status"] == "open" and data.get("summed_up") and message.get("channel") != "bubble":
        count = data.get("payments") or 0
        everything = f"{count} payments" if count > 1 else f"{data.get('rows')} rows"
        return [{"action": "show_all", "label": f"Show all {everything}", "style": "quiet"}]
    buttons = []
    if card["status"] == "applied" and result.get("offer") and not (message.get("payload") or {}).get("remembered"):
        buttons.append({"action": "remember_shops", "label": result["offer"]["label"]})
    if _can_undo(card, message):
        buttons.append({"action": "undo_card", "label": "Undo", "style": "quiet"})
    return buttons


CHANGES = [_change_kind(name, op.signature) for name, op in actions.OPS.items()]
CHANGES.append(_change_kind("merge", "", for_model=False))


def show_all(ctx: ActionContext) -> None:
    """Every row of a card, as a message in its chat (a "Show all" button, or typed)."""
    card = ctx.message.get("card")
    if not card or not (card.get("data") or {}).get("changes"):
        return
    rows = {"changes": card["data"]["changes"]}
    ctx.say("all_rows", actions.details(rows), {"groups": actions.detail_groups(rows), "card_id": card["id"]})


def remember_shops(ctx: ActionContext) -> None:
    """A tap on "Remember these shops" under an applied card: each shop it sorted gets its rule."""
    card = ctx.message.get("card") or {}
    offer = (card.get("result") or {}).get("offer")
    if card.get("status") != "applied" or not offer or (ctx.message.get("payload") or {}).get("remembered"):
        return
    with SessionLocal() as db:
        rows = [db.get(Transaction, i) for i in offer["transaction_ids"]]
        rules = [guesses.remember(db, t) for t in rows if t is not None and t.confirmed]
        said = questions.remembered_text([r for r in rules if r is not None])
        db.commit()
    ctx.update(payload={"remembered": said})


UNDO_NOTE = "This puts back how things were before that card was applied."


def undo_card(ctx: ActionContext) -> None:
    """A tap on Undo under an applied card: a card.undo card is offered, showing exactly what goes back."""
    card = ctx.message.get("card") or {}
    if card.get("status") != "applied" or (ctx.message.get("payload") or {}).get("undone"):
        return
    if not _can_undo(card, ctx.message):
        ctx.say("error", "That Undo is more than a week old, so it no longer works. Ask me to undo that card if you "
                         "still want it. Nothing changed.")
        return
    try:
        bot().offer(ctx.channel, "card.undo", f"Undo: {card.get('summary') or 'that change'}",
                    {"card_id": card["id"]}, reply_to=ctx.message["id"], note=UNDO_NOTE)
    except ChangeError as e:
        ctx.say("error", f"{e.reason}. Nothing changed.")


# ---- Files, photos and voice notes ------------------------------------------------------------------

def _merge_offers(new_transactions: list[Transaction], db) -> list[tuple[dict, str]]:
    offers = []
    for manual, bank in import_service.double_entries(new_transactions, db):
        label = "refund" if manual.is_refund else "entry"
        offers.append(({"manual_id": manual.id, "bank_id": bank.id}, (
            f"The manual {actions.describe_transaction(manual)['amount_label']} {label} matches the "
            f"bank row from {actions.describe_transaction(bank)['date_label']}."
        )))
    return offers


def handle_file(message: Incoming) -> None:
    """An ING export sent in the chat: imported and sorted here, and refused whole when Claude cannot sort it."""
    content = message.attachment or b""
    if len(content) > MAX_FILE_BYTES:
        message.say("error", "That file could not be used because it is too large. Nothing was imported.")
        return None
    try:
        rows = parse_ing(content)
    except BadFile as e:
        message.say("error", f"That file could not be used because {e}. {ONLY_ING} Nothing was imported.")
        return None

    message.step("Reading your file and sorting it")
    with SessionLocal() as db:
        try:
            outcome = import_service.import_rows(rows, db, cli_only=True)
        except claude_cli.ClaudeCliError as e:
            db.rollback()
            logger.warning("[chat] Claude failed during an import: %s", e)
            message.say("error", f"{claude_cli.explain(e)} Nothing was imported. Send the file again once that is sorted.")
            return None
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
        "noted": outcome.noted,
    }
    message.say("import", (
        f"Imported {outcome.imported} new, skipped {outcome.skipped} already here. "
        f"{outcome.by_rule + outcome.by_ai} sorted and counted ({outcome.by_rule} by rules, {outcome.by_ai} Claude was sure of), "
        f"{outcome.doubtful + outcome.uncategorised} waiting for an answer."
        + (f" {outcome.noted} already here got the bank's note." if outcome.noted else "")
    ), counts)
    questions.after_import(asked_in_chat=True)

    for args, description in offers:
        try:
            bot().offer(message.channel, "merge", description, args, reply_to=message.id)
        except Exception:
            logger.exception("[chat] could not offer a merge")
            merge_check_failed = True
    if merge_check_failed:
        message.say("error", MERGE_CHECK_FAILED)
    return None


def handle_photo(message: Incoming) -> ToModel | None:
    """A photo, with whatever was written under it, for Claude to look at."""
    picture = message.attachment or b""
    if len(picture) > MAX_PICTURE_BYTES or claude_cli.picture_type(picture) is None:
        message.say("error", UNREADABLE_PICTURE)
        return None
    return ToModel(picture=picture)


def handle_voice(message: Incoming) -> ToModel | None:
    """A voice note: what was heard goes in as the person's words. One that cannot be made out is said so, and
    nothing else happens."""
    content = message.attachment or b""
    try:
        heard = voice.transcribe(content) if len(content) <= MAX_FILE_BYTES else None
    except voice.TooLong:
        message.say("error", TOO_LONG)
        return None
    if not heard:
        message.say("error", UNHEARD)
        return None
    return ToModel(text=heard)


# ---- What Claude is given -----------------------------------------------------------------------------

def context(ctx: Ctx) -> dict:
    """Bounded: one month, whatever the history holds. Everything else is looked up when a reply needs it."""
    try:
        this_month = queries.month_overview()
    except Exception:
        logger.exception("[chat] reading this month for the prompt failed")
        this_month = {"error": "This month could not be read just now."}
    return {"payments_waiting_for_an_answer": questions.waiting_count(), "this_month": this_month}


_CARD_STATUS = {"open": "pending", "applying": "pending"}  # the words Claude has always been shown


def history_entry(message: dict) -> dict | None:
    """How one of finance's messages appears in <conversation>, as it always has."""
    payload = message.get("payload") or {}
    kind, role = message["kind"], message["role"]
    if role == "system":
        return None
    if role == "user":
        if kind == "file":
            return {"from": "person", "sent_a_bank_file": payload.get("filename") or message["text"] or "bank file"}
        entry = {"from": "person", "text": message["text"]}
        if kind == "photo":
            entry["sent_a_photo"] = True
        if kind == "voice":
            entry["heard_from_a_voice_note"] = True
        if payload.get("ended") == "stopped":
            entry["note"] = "they pressed Stop while you worked on this"
        return entry
    if kind == "card" and message.get("card"):
        card = message["card"]
        data = card.get("data") or {}
        shown = {"id": card["id"], "summary": card["summary"], "op": card["kind"],
                 "rows_changed": len(data.get("changes") or []),
                 "status": _CARD_STATUS.get(card["status"], card["status"])}
        if "args" in card and len(json.dumps(card["args"])) <= 1500:
            shown["args"] = card["args"]
        if card.get("error"):
            shown["error"] = card["error"]
        if payload.get("undone"):
            shown["undone"] = True
        entry = {"from": "app", "card": shown}
        if card.get("says"):
            entry["you_said_with_it"] = card["says"]
        return entry
    if kind == "question":
        asked = {"asked": message["text"], "transaction_ids": payload.get("transaction_ids", []),
                 "buttons": [o["label"] for o in payload.get("options", [])]}
        if payload.get("status") == "answered":
            asked["outcome"] = payload.get("result")
        return {"from": "app", **asked}
    if kind == "nudge":
        return {"from": "app", "sent_unasked": message["text"]}
    if kind == "reminder":
        return {"from": "app", "reminder_sent": message["text"]}
    if kind == "import":
        return {"from": "app", "import_summary": message["text"]}
    if kind == "error":
        return {"from": "app", "error": message["text"]}
    entry = {"from": "you", "text": message["text"]}  # an answer, and every row of a card (all_rows)
    if payload.get("about_question"):  # they pressed "Something else" on a question, and the app asked this
        entry = {"from": "app", "asked_after_something_else": message["text"],
                 "transaction_ids": payload.get("transaction_ids", [])}
    options = payload.get("options")
    if options:
        entry["choices_shown"] = [f"{o['label']}, {str(o.get('detail', '')).replace(' · ', ', ')} (id {o['id']})"
                                  for o in options]
    if payload.get("chart"):
        entry["chart_shown"] = payload["chart"].get("title") or "a chart"
    return entry


def describe_choice(choice_id) -> dict | None:
    """One payment to choose from: its name on the left, date and amount on the right."""
    with SessionLocal() as db:
        tx = db.get(Transaction, int(choice_id)) if str(choice_id).isdigit() else None
        if tx is None:
            return None
        row = actions.describe_transaction(tx)
    return {"label": row["description"], "detail": f"{row['date_label']} · {row['amount_label']}"}


def choice_text(choice_id) -> str:
    with SessionLocal() as db:
        row = actions.describe_transaction(db.get(Transaction, int(choice_id)))
    return f"That one: {row['description']}, {row['date_label']}, {row['amount_label']} (id {row['id']})"


def starters(ctx: Ctx) -> list[dict]:
    """A few things to ask in an empty chat, for the page that is open."""
    waiting = questions.waiting_count()
    review = [{"label": f"Go through the {waiting} to review",
               "text": f"Go through the {waiting} payments waiting for an answer"}] if waiting else []
    page = (ctx.page or "/").split("?")[0].rstrip("/") or "/"
    if page == "/transactions":
        return [*review, {"label": "Something got refunded", "text": "Something got refunded"},
                {"label": "I paid cash for something", "text": "I paid cash for something"}]
    if page == "/import":
        return [{"label": "What did the last import bring in?", "text": "What did the last import bring in?"},
                {"label": "Where does the bank data stop?", "text": "Where does the bank data stop?"}, *review]
    if page == "/trends":
        return [{"label": "How did the last six months go?", "text": "How did the last six months go?"},
                {"label": "Show spending per category", "text": "Show spending per category over the last six months"}]
    if page == "/setup":
        return [{"label": "Does our plan still fit?", "text": "Does our plan still fit what we really spend?"},
                {"label": "Which bills come back each year?", "text": "Which bills come back each year?"}]
    if page == "/report":
        return [{"label": "Sum up last month", "text": "Sum up last month in a few lines"},
                {"label": "Where did most of it go?", "text": "Where did most of the money go last month?"}]
    return [{"label": "How are we doing this month?", "text": "How are we doing this month?"},
            {"label": "Something got refunded", "text": "Something got refunded"}, *review]


def chart_picture(message: dict, theme: str) -> bytes | None:
    chart = (message.get("payload") or {}).get("chart")
    return charts.render(chart, theme) if chart else None


# ---- The bot ------------------------------------------------------------------------------------------

_bot: Bot | None = None
_bot_guard = threading.Lock()


def bot() -> Bot:
    """The household's bot, made on first use (after the migrations, which copy old chats into its store)."""
    global _bot
    with _bot_guard:
        if _bot is None:
            _bot = Bot(
                name="household-finance",
                instructions=SYSTEM_PROMPT,
                context=context,
                tools=TOOLS,
                changes=CHANGES,
                starters=starters,
                history_entry=history_entry,
                handlers={"file": handle_file, "photo": handle_photo, "voice": handle_voice},
                actions={
                    "answer": questions.answer, "something_else": questions.something_else,
                    "remember": questions.remember, "show_all": show_all, "remember_shops": remember_shops,
                    "undo_card": undo_card,
                },
                typed_actions={"show_all": SHOW_ALL_WORDS},
                describe_choice=describe_choice,
                choice_text=choice_text,
                image=chart_picture,
                runners=claude_cli.runner_config(),
                store_path=bot_store_path(),
                time_limit_seconds=TIME_LIMIT_SECONDS,
                quiet_hours=clock.quiet_hours,
                clock=clock.now,
                wrap_up=WRAP_UP,
                refresh=questions.refresh,
            )
        return _bot
