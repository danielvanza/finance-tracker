"""The household's Telegram bot: bot-kit's Telegram front (`botkit.telegram`, SPEC §11) with finance's layouts.

Runs as its own process (deploy/household-finance-telegram.service). It works in one group, with the two people of
the household: either of them can ask, and either can press a card's buttons. Any other account and any other group
get silence; a private message from one of the two gets one line pointing to the group. Message contents are never
logged. The kit does the talking to Telegram and to the app (its HTTP API at FINANCE_API_URL + /chat): polling,
uploads, the outbox, the live log with Stop, buttons, edits in place, delivery marks, and the HTML.

Needs TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS (the two numeric accounts, comma-separated) and
TELEGRAM_GROUP_ID (the group's numeric id); FINANCE_API_URL points at the app. Without a group id the bot answers
nobody and only logs the id of any group one of the two writes in, so it can be set. In BotFather the bot's group
privacy must be off, or Telegram hands it commands only.

What is finance's own is here: how its messages look (docs/design/telegram.md, docs/bot.md for what they carry),
the first reply to a voice note saying what was heard, and its words. Every render_* returns HTML with the text in it
escaped.
"""
import logging
import os
import sys

from botkit.telegram import (
    TEXT_LIMIT, Front, Settings, Shown, Texts, View, apply_key, button_rows, choice_key, columns, esc, quiet_http_log,
    quote, reject_key, rich,
)

logger = logging.getLogger("finance-telegram")

MAX_SAYS = 700  # Claude's words longer than this go out ahead of the card instead of on it
LINE_LIMIT = 110  # a card that would not fit one message has its lines cut to this

TEXTS = Texts(
    app_down="The finance app can't be reached right now, so nothing changed. Try again in a moment.",
    app_unsure="The finance app stopped answering, so I can't tell whether that went through. Check the app before trying again.",
    app_refused="The finance app didn't accept that, so nothing changed.",
    app_lost="The finance app stopped while working on that. It will carry on when it is back, and the answer will come here.",
    waiting="Waiting for Claude. Your message is saved and will be answered as soon as it is free.",
    hello=("Hello. Ask me anything about your money, tell me about a payment in words, a voice note or a photo, or "
           "send an ING export. We carry on where we left off; send /new to start a new chat."),
    image_lost="The chart could not be sent this time.",
    not_understood="I can read text, voice notes, photos and ING exports. Say what happened in one of those.",
    lost={
        "file": "That file could not be used because Telegram would not hand it over. Nothing was imported.",
        "photo": "That photo could not be used because Telegram would not hand it over. Nothing changed.",
        "voice": "That voice note could not be used because Telegram would not hand it over. Nothing changed.",
    },
    notices={"file": "Reading your file and sorting it. This can take a few minutes."},
)

UPLOADS = {
    "document": ("file", "bank file"),
    "voice": ("voice", "voice.ogg"),
    "audio": ("voice", "voice.ogg"),
    "photo": ("photo", "photo.jpg"),
}

def eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, rem = divmod(abs(cents), 100)
    return f"{sign}€{whole:,}".replace(",", ".") + f",{rem:02d}"


def heard(view: View | None) -> str:
    """'Heard: “…”' (plain) above the first reply to a voice note, so a mishearing shows at once."""
    if view is None:
        return ""
    asked = view.asked()
    if not asked or asked.get("kind") != "voice" or not asked.get("text") or not view.first_reply():
        return ""
    return f"Heard: “{asked['text']}”\n\n"


# ---- Cards ------------------------------------------------------------------------------------------------------

def _card_text(head: list[str], lines: list[str], tail: list[str]) -> str:
    """The card as one message: `head` and `tail` are ready, `lines` are plain. When it would not fit, the lines are
    cut short rather than spilling over."""
    def build(limit: int | None) -> str:
        shown = [esc(line if limit is None or len(line) <= limit else line[:limit - 1] + "…") for line in lines]
        return "\n".join([*head, *shown, *tail])

    text = build(None)
    return text if len(text) <= TEXT_LIMIT else build(LINE_LIMIT)


def _still_waiting(waiting: int | None) -> list[str]:
    if waiting is None:
        return []
    if waiting == 0:
        return ["Nothing is waiting any more."]
    return [f"{waiting} payment{' still waits' if waiting == 1 else 's still wait'}."]


def render_card(message: dict, view: View | None = None) -> Shown:
    """A card: before Apply, Claude's words, the count in bold, a line per category, any note, the budget quote, and
    Apply / Not this (plus Show all for a summed-up one); after Apply, one sentence, the budget, what still waits,
    and the offer to remember the shops it sorted."""
    card = message["card"]
    data, result = card.get("data") or {}, card.get("result") or {}
    status = card["status"]
    extra = button_rows(message)  # Show all (open, summed up) or Remember these shops (applied, until done)
    said = heard(view)
    if status == "applied":
        # One sentence for what happened, the budget set apart, then what is left.
        effect = quote([esc(line) for line in result.get("effect_lines") or []])
        lines = card["lines"]
        summed_up = data.get("applied_line") or (lines[0] if len(lines) == 1 else None)
        remembered = (message.get("payload") or {}).get("remembered")
        tail = [*effect, *_still_waiting(result.get("waiting")), *([esc(remembered)] if remembered else [])]

        def sentence(words: str | None) -> str:
            head = [f"<b>Applied.</b> {esc(words)}" if words else "<b>Applied.</b>"]
            return _card_text(head, [] if words else lines, tail)

        text = sentence(summed_up)
        if summed_up and len(text) > TEXT_LIMIT:  # one message, whatever the length of the row it names
            text = sentence(summed_up[:LINE_LIMIT - 1] + "…")
        return Shown(esc(said) + text, extra or None)
    if status == "rejected":
        return Shown("Kept both. Nothing changed." if card["reject_label"] == "Keep both"
                     else "Not applied. Nothing changed.")
    if status == "superseded":
        return Shown("Replaced by a newer suggestion. Nothing changed.")
    if status == "failed":
        return Shown(f"That didn't go through, and nothing changed.\n\n{esc(card['error'] or '')}",
                     [[apply_key(card, "Try again")]])

    head = []
    says = card.get("says")
    ahead = None
    if says and len(says) <= MAX_SAYS:
        head += [rich(says), ""]
    elif says and not message.get("delivered"):
        ahead = rich(says)  # too long to sit on the card
    if card["apply_label"] == "Merge":
        head += [esc(card["heading"]), esc(card["summary"])]
    lines = card["lines"]
    if data.get("summed_up") and data.get("short_lines"):
        # A long card: its count in bold, then a line per category without the shops.
        head.append(f"<b>{esc(data['head'])}</b>")
        lines = data["short_lines"]
    tail = []
    if card.get("note"):
        tail.append(esc(card["note"]))
    purchase = data.get("purchase")
    if purchase:
        tail.append(esc(f"Refund for: {purchase['description']}, {purchase['date_label']} ({purchase['amount_label']})"))
    tail += quote([esc(line) for line in data.get("effect_lines") or []])
    keys = [[apply_key(card), reject_key(card)], *extra]
    return Shown(esc(said) + _card_text(head, lines, tail), keys, ahead=ahead)


# ---- Questions, imports, every row of a card --------------------------------------------------------------------

def render_question(message: dict, view: View | None = None) -> Shown:
    """A question about payments Claude was not sure of: who was paid in bold, each payment with what the payer typed,
    the question last, and the likely categories as buttons."""
    payload = message["payload"]
    keys = button_rows(message) or None  # the answers and Something else; once answered, Remember … for next time
    if payload["status"] != "open":
        return Shown(esc(f"{payload['name']}: {payload.get('result') or 'Sorted.'}"), keys)

    def payment(example: dict) -> str:
        note = f" · <i>“{esc(example['note'])}”</i>" if example.get("note") else ""
        return f"{esc(example['date_label'])} · {esc(example['amount_label'])}{note}"

    name, examples = f"<b>{esc(payload['name'])}</b>", payload["examples"]
    if payload["count"] == 1 and examples:
        lines = [f"{name} · {payment(examples[0])}"]
    else:
        lines = [f"{name} · {payload['count']} payments, {eur(abs(payload['total_cents']))}", *map(payment, examples)]
        if payload["count"] > len(examples):
            lines.append(f"and {payload['count'] - len(examples)} more")
    lines += ["", "What was this money for?" if payload.get("incoming") else "Where does it belong?"]
    return Shown("\n".join(lines), keys)


def render_details(groups: list[dict]) -> str:
    """Every row of a card: a bold heading per kind of change, its payments in columns."""
    if len(groups) == 1 and "lines" in groups[0] and groups[0]["heading"] == "Other changes":
        return "\n".join(f"• {esc(line)}" for line in groups[0]["lines"])
    parts = []
    for group in groups:
        rows = group.get("rows")
        parts.append(f"<b>{esc(group['heading'])}</b> · {len(rows or group['lines'])}")
        if rows:
            parts.append(f"<pre>{esc(columns(rows))}</pre>")
        else:
            parts += [esc(line) for line in group["lines"]]
    return "\n".join(parts)


def render_import(counts: dict) -> str:
    waiting = counts.get("doubtful", 0) + counts["uncategorised"]
    sorted_now = counts["by_rule"] + counts["by_ai"]
    noted = counts.get("noted", 0)
    notes = f"{noted} payment{'' if noted == 1 else 's'} already here got the bank's note." if noted else ""
    if not counts["imported"]:
        return "\n".join(filter(None, [f"ING import: nothing new. All {counts['skipped']} payments were here already.", notes]))
    lines = [f"ING import: {counts['imported']} new payment{'' if counts['imported'] == 1 else 's'}"
             + (f" ({counts['skipped']} were here already)." if counts["skipped"] else ".")]
    said = [f"{sorted_now} sorted and counted"] if sorted_now else []
    if waiting:
        said.append(f"{waiting} need{'s' if waiting == 1 else ''} your answer, which I will ask about here")
    sentence = ", ".join(said)
    lines.append(sentence[:1].upper() + sentence[1:] + "." if said else "")
    lines.append(notes)
    return "\n".join(line for line in lines if line)


def _option_label(option: dict) -> str:
    """A payment to choose from: date, amount, then its name."""
    return f"{option['detail']} · {option['label']}"


def render_answer(message: dict, view: View | None = None) -> Shown:
    """Claude's own words (bold leads, bullets, a folded long list), a "which one?" with a button per payment, and a
    chart as a photo under the words."""
    payload = message.get("payload") or {}
    said = heard(view)
    chart = bool(payload.get("chart"))
    options = payload.get("options") or []
    if options:
        lines = [said + message["text"], "", *[f"• {_option_label(o)}" for o in options]]
        keys = [[choice_key(o["id"], _option_label(o)[:60])] for o in options]
        return Shown(esc("\n".join(lines)), keys, image=chart)
    return Shown(esc(said) + rich(message["text"]), image=chart)


def render_all_rows(message: dict, view: View | None = None) -> Shown:
    return Shown(esc(heard(view)) + render_details((message.get("payload") or {}).get("groups") or []))


def render_import_message(message: dict, view: View | None = None) -> Shown:
    return Shown(esc(render_import(message["payload"])))


def render_plain(message: dict, view: View | None = None) -> Shown:
    """An error, an unasked message: the words as they are."""
    return Shown(esc(heard(view) + message["text"]))


RENDERERS = {
    "card": render_card, "question": render_question, "answer": render_answer, "all_rows": render_all_rows,
    "import": render_import_message, "nudge": render_plain, "error": render_plain,
}


def log_lead(item: dict, view: View) -> str | None:
    """The live log of a voice note starts with what was heard, once it is."""
    if item.get("kind") != "voice":
        return None
    asked = view.asked()
    return f"Heard: “{asked['text']}”" if asked and asked.get("text") else None


def legacy_callback(data: str, front: Front) -> str | None:
    """Buttons on messages the bot sent before it moved onto bot-kit: q:{question}:{n|x|m}, d:{card} (Show all) and
    m:{card} (Remember these shops). Apply, reject, Stop and choosing a payment kept their data."""
    action, _, rest = data.partition(":")
    raw_id, _, more = rest.partition(":")
    if not raw_id.isdigit():
        return None
    if action == "q":
        if more == "x":
            return f"b:{raw_id}:something_else"
        if more == "m":
            return f"b:{raw_id}:remember"
        return f"b:{raw_id}:answer:{int(more)}" if more.isdigit() else None
    if action in ("d", "m"):
        message = front.card_message(int(raw_id))
        if message is None:
            return None
        return f"b:{message['id']}:{'show_all' if action == 'd' else 'remember_shops'}"
    return None


def make_front(token: str, allowed: set[int], group: int | None, api_url: str,
               telegram_api: str = "https://api.telegram.org") -> Front:
    return Front(
        Settings(api_url=f"{api_url.rstrip('/')}/chat", token=token, allowed_user_ids=allowed, group_id=group,
                 telegram_api=telegram_api),
        renderers=RENDERERS, texts=TEXTS, log_lead=log_lead, uploads=UPLOADS, callback_alias=legacy_callback,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    quiet_http_log()  # its request log contains the token
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    # TELEGRAM_ALLOWED_USER_ID is the earlier name, from when the bot answered one account.
    allowed = [part.strip() for part in (os.getenv("TELEGRAM_ALLOWED_USER_IDS") or os.getenv("TELEGRAM_ALLOWED_USER_ID", "")).split(",") if part.strip()]
    group = os.getenv("TELEGRAM_GROUP_ID", "").strip()
    if not token or not allowed or not all(part.isdigit() for part in allowed):
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS (the household's numeric Telegram user ids, comma-separated).")
    if group and not group.lstrip("-").isdigit():
        sys.exit("TELEGRAM_GROUP_ID must be the group's numeric id, such as -1001234567890.")
    if group:
        logger.info("Finance bot started")
    else:
        logger.warning("TELEGRAM_GROUP_ID is not set: answering nobody. Write in the group and its id is logged here.")
    make_front(token, {int(part) for part in allowed}, int(group) if group else None,
               os.getenv("FINANCE_API_URL", "http://127.0.0.1:18600/api"),
               os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")).run()


if __name__ == "__main__":
    main()
