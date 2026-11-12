"""The household's Telegram bot: a thin front on the app's own chat API, so both chats act the same.

Runs as its own process (deploy/household-finance-telegram.service). It works in one group, with the
two people of the household: either of them can ask, and either can press a card's buttons. Any other
account and any other group get silence; a private message from one of the two gets one line pointing
to the group. Message contents are never logged.

Needs TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS (the two numeric accounts, comma-separated) and
TELEGRAM_GROUP_ID (the group's numeric id); FINANCE_API_URL points at the app. Without a group id the
bot answers nobody and only logs the id of any group one of the two writes in, so it can be set.
In BotFather the bot's group privacy must be off, or Telegram hands it commands only.
"""
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

logger = logging.getLogger("finance-telegram")

TEXT_LIMIT = 3900
POLL_SECONDS = 10
WAIT_NOTE_AFTER_SECONDS = 3
APP_DOWN = "The finance app can't be reached right now, so nothing changed. Try again in a moment."
APP_UNSURE = "The finance app stopped answering, so I can't tell whether that went through. Check the app before trying again."
APP_REFUSED = "The finance app didn't accept that, so nothing changed."
APP_LOST = "The finance app stopped while working on that. It will carry on when it is back, and the answer will come here."
WAITING = "Waiting for Claude. Your message is saved and will be answered as soon as it is free."
READING = "Reading your file and sorting it. This can take a few minutes."
NEW_CHAT = "Started a new chat. I won't draw on what we said before."
# Telegram sends /start whenever the bot is opened afresh, so it must never cost the conversation.
HELLO = "Hello. Ask me anything about your money, tell me about a payment in words, a voice note or a photo, or send an ING export. We carry on where we left off; send /new to start a new chat."
GROUP_ONLY = "I only work in our shared group. Write to me there."
UNHEARD = "I could not make that out. Could you say it again, or type it? Nothing changed."
TOO_LONG = "That voice note is too long for me. Keep it under two minutes, or type it. Nothing changed."
PHOTO_LOST = "That photo could not be used because Telegram would not hand it over. Nothing changed."
VOICE_LOST = "That voice note could not be used because Telegram would not hand it over. Nothing changed."
MAX_SAYS = 700  # Claude's words longer than this go out ahead of the card instead of on it
LINE_LIMIT = 110  # a card that would not fit one message has its lines cut to this
NOTHING_TO_STOP = "Nothing is being worked on right now."
STOP_WORDS = {"stop", "/stop"}
LOG_STEPS = 40
CHART_LOST = "The chart could not be sent this time."
NOT_UNDERSTOOD = "I can read text, voice notes, photos and ING exports. Say what happened in one of those."
# What a person can send that the bot cannot read.
UNREADABLE = ("sticker", "video", "video_note", "animation", "location", "venue", "contact", "poll", "dice")
# A bad answer from Telegram itself: refused, unreachable, or not JSON at all.
TELEGRAM_FAILED = (RuntimeError, httpx.HTTPError, ValueError)


class AppDown(Exception):
    """A request failed. `unknown` means it may have got through, so its outcome can't be stated."""

    def __init__(self, message: str, unknown: bool):
        super().__init__("app unavailable")
        self.message = message
        self.unknown = unknown


class Telegram:
    def __init__(self, token: str, base: str):
        self._api = f"{base}/bot{token}"
        self._files = f"{base}/file/bot{token}"
        self._http = httpx.Client(timeout=httpx.Timeout(15, connect=5))
        # Waiting for news has its own connection, so a stalled wait is noticed fast and can't hold up a send.
        self._polling = httpx.Client(timeout=httpx.Timeout(POLL_SECONDS + 5, connect=5))

    def call(self, method: str, **params):
        return self._result(method, self._http.post(f"{self._api}/{method}", json=params))

    def send_photo(self, chat_id: int, png: bytes):
        response = self._http.post(
            f"{self._api}/sendPhoto", data={"chat_id": chat_id}, files={"photo": ("chart.png", png, "image/png")},
        )
        return self._result("sendPhoto", response)

    def get_updates(self, **params):
        return self._result("getUpdates", self._polling.post(f"{self._api}/getUpdates", json=params))

    @staticmethod
    def _result(method: str, response: httpx.Response):
        body = response.json()
        if not body.get("ok"):
            raise RuntimeError(f"{method}: {body.get('description', response.status_code)}")
        return body["result"]

    def download(self, file_id: str) -> bytes:
        path = self.call("getFile", file_id=file_id)["file_path"]
        response = self._http.get(f"{self._files}/{path}")
        response.raise_for_status()
        return response.content


class Finance:
    def __init__(self, base: str):
        self._base = base.rstrip("/")
        self._http = httpx.Client(timeout=60)

    def _request(self, method: str, path: str, raw: bool = False, **kwargs):
        try:
            response = self._http.request(method, f"{self._base}{path}", **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise AppDown(APP_DOWN, unknown=False) from e
        except httpx.HTTPError as e:
            raise AppDown(APP_UNSURE, unknown=True) from e
        if response.status_code >= 500:
            raise AppDown(APP_UNSURE, unknown=True)
        if response.status_code >= 400:
            raise AppDown(APP_REFUSED, unknown=False)
        return response.content if raw else response.json()

    def send_voice(self, content: bytes):
        return self._request("POST", "/chat/voice", data={"channel": "telegram"}, files={"file": ("voice.ogg", content)})

    def send_photo(self, content: bytes, caption: str):
        return self._request(
            "POST", "/chat/photos", data={"channel": "telegram", "caption": caption}, files={"file": ("photo.jpg", content)},
        )

    def answer(self, message_id: int, option: int):
        return self._request("POST", f"/chat/questions/{message_id}/answer", json={"option": option})

    def something_else(self, message_id: int):
        return self._request("POST", f"/chat/questions/{message_id}/something-else")

    def show_all(self, proposal_id: int):
        return self._request("POST", f"/chat/proposals/{proposal_id}/show-all")

    def send(self, text: str = "", choose: int | None = None):
        return self._request("POST", "/chat/messages", json={
            "channel": "telegram", "text": text, "choose_transaction_id": choose,
        })

    def send_file(self, name: str, content: bytes):
        return self._request("POST", "/chat/files", data={"channel": "telegram"}, files={"file": (name, content)})

    def outbox(self):
        return self._request("GET", "/chat/outbox", params={"channel": "telegram"})

    def delivered(self, message_id: int, telegram_ids: list[int]):
        return self._request("POST", f"/chat/messages/{message_id}/delivered", json={"message_ids": telegram_ids})

    def chart(self, message_id: int) -> bytes:
        return self._request("GET", f"/chat/messages/{message_id}/chart", raw=True)

    def apply(self, proposal_id: int, version: str):
        return self._request("POST", f"/chat/proposals/{proposal_id}/apply", json={"version": version})

    def reject(self, proposal_id: int):
        return self._request("POST", f"/chat/proposals/{proposal_id}/reject")

    def stop(self) -> int:
        return self._request("POST", "/chat/stop", json={"channel": "telegram"})["stopped"]

    def new_chat(self):
        return self._request("POST", "/chat/new", json={"channel": "telegram"})


def eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, rem = divmod(abs(cents), 100)
    return f"{sign}€{whole:,}".replace(",", ".") + f",{rem:02d}"


def _fit(head: list[str], lines: list[str], tail: list[str]) -> str:
    """The card as one message: when it would not fit, its lines are cut short rather than spilling over."""
    text = "\n".join([*head, *lines, *tail])
    if len(text) <= TEXT_LIMIT:
        return text
    cut = [line if len(line) <= LINE_LIMIT else line[:LINE_LIMIT - 1] + "…" for line in lines]
    return "\n".join([*head, *cut, *tail])[:TEXT_LIMIT]


def render_card(card: dict) -> tuple[str, list | None]:
    """The card as text, and its buttons (None once there is nothing left to decide)."""
    status = card["status"]
    if status == "applied":
        lines = card["lines"]
        first = f"Applied. {lines[0]}" if len(lines) == 1 else "Applied."
        rest = lines if len(lines) != 1 else []
        return _fit([first], rest, card["effect_lines"]), None
    if status == "rejected":
        return ("Kept both. Nothing changed." if card["reject_label"] == "Keep both"
                else "Not applied. Nothing changed."), None
    if status == "superseded":
        return "Replaced by a newer suggestion. Nothing changed.", None
    if status == "failed":
        text = f"That didn't go through, and nothing changed.\n\n{card['error']}"
        return text, [[{"text": "Try again", "callback_data": f"a:{card['id']}:{card['version']}"}]]

    head = []
    says = card.get("says")
    if says and len(says) <= MAX_SAYS:
        head += [says, ""]
    if card["apply_label"] == "Merge":
        head += [card["heading"], card["summary"]]
    tail = []
    if card["note"]:
        tail.append(card["note"])
    if card["purchase"]:
        purchase = card["purchase"]
        tail.append(f"Refund for: {purchase['description']}, {purchase['date_label']} ({purchase['amount_label']})")
    tail += card["effect_lines"]
    buttons = [[
        {"text": card["apply_label"], "callback_data": f"a:{card['id']}:{card['version']}"},
        {"text": card["reject_label"], "callback_data": f"r:{card['id']}"},
    ]]
    if card["summed_up"]:
        buttons.append([{"text": f"Show all {card['rows']} rows", "callback_data": f"d:{card['id']}"}])
    return _fit(head, card["lines"], tail), buttons


def render_question(message: dict) -> tuple[str, list | None]:
    """A question about payments Claude was not sure of: the likely categories as buttons."""
    payload = message["payload"]
    if payload["status"] != "open":
        return f"{payload['name']}: {payload.get('result') or 'Sorted.'}", None
    lines = [message["text"]]
    if payload["count"] > 1:
        lines += [f"• {e['date_label']} · {e['amount_label']}" for e in payload["examples"]]
        if payload["count"] > len(payload["examples"]):
            lines.append(f"• and {payload['count'] - len(payload['examples'])} more")
    buttons = [
        [{"text": option["label"][:60], "callback_data": f"q:{message['id']}:{i}"}]
        for i, option in enumerate(payload["options"])
    ]
    buttons.append([{"text": "Something else", "callback_data": f"q:{message['id']}:x"}])
    return "\n".join(lines), buttons


def render_import(counts: dict) -> str:
    waiting = counts.get("doubtful", 0) + counts["uncategorised"]
    sorted_now = counts["by_rule"] + counts["by_ai"]
    if not counts["imported"]:
        return f"ING import: nothing new. All {counts['skipped']} payments were here already."
    lines = [f"ING import: {counts['imported']} new payment{'' if counts['imported'] == 1 else 's'}"
             + (f" ({counts['skipped']} were here already)." if counts["skipped"] else ".")]
    said = [f"{sorted_now} sorted and counted"] if sorted_now else []
    if waiting:
        said.append(f"{waiting} need{'s' if waiting == 1 else ''} your answer, which I will ask about here")
    sentence = ", ".join(said)
    lines.append(sentence[:1].upper() + sentence[1:] + "." if said else "")
    return "\n".join(line for line in lines if line)


def _chunks(text: str) -> list[str]:
    """Pieces that fit one Telegram message, broken between lines where possible."""
    chunks, current = [], ""
    for line in text.split("\n"):
        while len(line) > TEXT_LIMIT:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:TEXT_LIMIT])
            line = line[TEXT_LIMIT:]
        if current and len(current) + 1 + len(line) > TEXT_LIMIT:
            chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current.strip():
        chunks.append(current)
    return chunks or [" "]


def render_log(steps: list[str], status: str, heard: str | None = None) -> tuple[str, list | None]:
    """The live log of one reply: one message, edited as the steps come in, with Stop. It is taken away
    when the reply is there."""
    heading = "Stopping…" if status == "stopping" else "Working on it…"
    shown = steps[-LOG_STEPS:]
    lines = [*([f"Heard: “{heard}”"] if heard else []), heading,
             *(["…"] if len(steps) > len(shown) else []), *[f"• {step}" for step in shown]]
    buttons = None if status == "stopping" else [[{"text": "Stop", "callback_data": "s:0"}]]
    return "\n".join(lines), buttons


def _option_label(option: dict) -> str:
    return f"{option['date_label']} · {option['amount_label']} · {option['description']}"


class Bot:
    def __init__(self, telegram: Telegram, finance: Finance, allowed_user_ids: set[int], group_id: int | None):
        self.telegram = telegram
        self.finance = finance
        self.allowed = allowed_user_ids
        self.group = group_id
        self._told_waiting: set[int] = set()
        self._logs: dict[int, dict] = {}  # message id -> its log in Telegram: message_id, text, status
        self._in_flight: list[dict] = []
        self._told_lost = False
        self._last_typing = 0.0
        self._groups_seen: set[int] = set()

    def is_allowed(self, sender: dict | None, chat: dict | None) -> bool:
        """One of the household's two people, writing in the household's group."""
        return bool(
            sender and chat and self.group is not None and sender.get("id") in self.allowed
            and chat.get("id") == self.group and chat.get("type") in ("group", "supergroup")
        )

    def _elsewhere(self, sender: dict | None, chat: dict | None) -> None:
        """Someone wrote outside the group. One of the two, in private, is pointed to the group; a group
        that is not set up is only noted in the log, so its id can be found. Everything else: silence."""
        if not sender or not chat or sender.get("id") not in self.allowed:
            return
        if chat.get("type") == "private" and chat.get("id") == sender.get("id"):
            self._safely(lambda _: self.telegram.call("sendMessage", chat_id=chat["id"], text=GROUP_ONLY), None)
        elif chat.get("type") in ("group", "supergroup") and chat.get("id") not in self._groups_seen:
            self._groups_seen.add(chat["id"])
            logger.info("one of the household wrote in group %s, which is not the group set in TELEGRAM_GROUP_ID", chat["id"])

    def _send(self, chunk: str, buttons: list | None) -> int:
        params = {"chat_id": self.group, "text": chunk}
        if buttons:
            params["reply_markup"] = {"inline_keyboard": buttons}
        return self.telegram.call("sendMessage", **params)["message_id"]

    def say(self, text: str, buttons: list | None = None) -> list[int]:
        """Send text, in several messages if long. Buttons go on the last one."""
        chunks = _chunks(text)
        return [self._send(chunk, buttons if i == len(chunks) - 1 else None) for i, chunk in enumerate(chunks)]

    def edit(self, message_id: int, text: str, buttons: list | None) -> None:
        params = {"chat_id": self.group, "message_id": message_id, "text": text[:TEXT_LIMIT]}
        params["reply_markup"] = {"inline_keyboard": buttons or []}
        try:
            self.telegram.call("editMessageText", **params)
        except RuntimeError:
            logger.info("could not edit a message; it was probably already up to date")

    def _show(self, text: str, buttons: list | None, shown: list[int], message_id: int) -> list[int]:
        """Show a message, replacing every Telegram message that already shows it."""
        chunks = _chunks(text)
        ids = []
        for i, chunk in enumerate(chunks):
            keys = buttons if i == len(chunks) - 1 else None
            if i < len(shown):
                self.edit(shown[i], chunk, keys)
                ids.append(shown[i])
            else:
                ids.append(self._send(chunk, keys))
        for extra in shown[len(chunks):]:
            try:
                self.telegram.call("deleteMessage", chat_id=self.group, message_id=extra)
            except RuntimeError:
                logger.info("could not delete an old part of a message")
        if shown and ids != shown:
            self.finance.delivered(message_id, ids)
        return ids

    def show_card(self, card: dict, heard: str | None = None) -> list[int]:
        text, buttons = render_card(card)
        ids = []
        if card["status"] == "pending" and card.get("says") and len(card["says"]) > MAX_SAYS and not card["message_ids"]:
            self.say(card["says"])  # too long to sit on the card
        if heard:
            text = f"Heard: “{heard}”\n\n{text}"
        return ids + self._show(text, buttons, list(card["message_ids"]), card["message_id"])

    def show_question(self, message: dict, shown: list[int]) -> list[int]:
        text, buttons = render_question(message)
        return self._show(text, buttons, shown, message["id"])

    def show_reply(self, reply: dict) -> list[int]:
        heard = reply.get("heard")
        if reply["kind"] == "proposal":
            return self.show_card(reply["card"], heard)
        if reply["kind"] == "question":
            return self.show_question(reply, [])
        said = f"Heard: “{heard}”\n\n" if heard else ""
        if reply["kind"] == "import":
            return self.say(render_import(reply["payload"]))
        if reply["kind"] == "clarify":
            options = (reply.get("payload") or {}).get("options", [])
            lines = [said + reply["text"], "", *[f"• {_option_label(o)}" for o in options]]
            buttons = [[{"text": _option_label(o)[:60], "callback_data": f"c:{o['id']}"}] for o in options]
            return self.say("\n".join(lines), buttons or None)
        ids = self.say(said + reply["text"])
        if (reply.get("payload") or {}).get("chart"):
            ids += self._send_chart(reply["id"])
        return ids

    def _send_chart(self, message_id: int) -> list[int]:
        """The picture beside the words. The words are already out, so a failure here must not resend them."""
        try:
            return [self.telegram.send_photo(self.group, self.finance.chart(message_id))["message_id"]]
        except (AppDown, *TELEGRAM_FAILED):
            logger.warning("a chart could not be sent")
        try:
            return self.say(CHART_LOST)
        except TELEGRAM_FAILED:
            return []

    def pump_once(self) -> None:
        """Show every reply not shown yet, bring changed ones up to date, and say so when a message is waiting its turn."""
        box = self.finance.outbox()
        self._told_lost = False
        self._in_flight = box["in_flight"]
        # The log goes before the reply comes, so the chat never shows both.
        self._update_logs()
        for reply in box["replies"]:
            self.finance.delivered(reply["id"], self.show_reply(reply))
        for changed in box.get("edits", []):
            if changed["kind"] == "question":
                ids = self.show_question(changed, list(changed.get("delivered_ids") or []))
            else:
                ids = self.show_card(changed["card"])
            self.finance.delivered(changed["id"], ids)
        for item in self._in_flight:
            late = item["status"] == "queued" and item["age_seconds"] >= WAIT_NOTE_AFTER_SECONDS
            if (item["status"] == "waiting" or late) and item["id"] not in self._told_waiting:
                self._told_waiting.add(item["id"])
                self.say(WAITING)
        if self._in_flight and time.monotonic() - self._last_typing > 4:
            self._last_typing = time.monotonic()
            self.telegram.call("sendChatAction", chat_id=self.group, action="typing")

    def _update_logs(self) -> None:
        """One message per reply being worked on, kept up to date, and taken away once the reply is done."""
        working = {item["id"]: item for item in self._in_flight if item.get("kind", "text") != "file"}
        for item_id, item in working.items():
            if item["status"] not in ("running", "stopping") and item_id not in self._logs:
                continue
            log = self._logs.get(item_id)
            text, buttons = render_log(item.get("steps", []), item["status"], item.get("heard"))
            if log is None:
                log = self._logs[item_id] = {"message_id": self._send(text, buttons), "text": text}
            elif log["text"] != text:
                self.edit(log["message_id"], text, buttons)
                log["text"] = text
            log.update(steps=item.get("steps", []), heard=item.get("heard"))
        for item_id in [i for i in self._logs if i not in working]:
            log = self._logs.pop(item_id)
            try:
                self.telegram.call("deleteMessage", chat_id=self.group, message_id=log["message_id"])
            except TELEGRAM_FAILED:
                logger.info("could not remove a finished log")

    def pump_forever(self) -> None:
        while True:
            try:
                self.pump_once()
            except AppDown:
                if self._in_flight and not self._told_lost:
                    self._told_lost = True
                    self._safely(lambda _: self.say(APP_LOST), None)
            except (RuntimeError, httpx.HTTPError) as e:
                logger.warning("delivering replies failed: %s", type(e).__name__)
            except Exception:
                logger.exception("delivering replies failed")
            time.sleep(1)

    def _fetch(self, file_id: str, lost: str) -> bytes | None:
        try:
            return self.telegram.download(file_id)
        except TELEGRAM_FAILED:
            self.say(lost)
            return None

    def on_message(self, message: dict) -> None:
        if not self.is_allowed(message.get("from"), message.get("chat")):
            self._elsewhere(message.get("from"), message.get("chat"))
            return
        # In a group a command may carry the bot's name: /new@FinanceBot.
        command = message.get("text", "").strip().lower().split("@")[0]
        try:
            if message.get("document"):
                document = message["document"]
                content = self._fetch(document["file_id"], "That file could not be used because Telegram would not hand it over. Nothing was imported.")
                if content is None:
                    return
                self._safely(lambda _: self.say(READING), None)  # the file matters more than the notice
                self.finance.send_file(document.get("file_name") or "bank file", content)
            elif message.get("voice") or message.get("audio"):
                content = self._fetch((message.get("voice") or message["audio"])["file_id"], VOICE_LOST)
                if content is None:
                    return
                heard = self.finance.send_voice(content)
                if not heard.get("heard"):
                    self.say(TOO_LONG if heard.get("too_long") else UNHEARD)
            elif message.get("photo"):
                biggest = max(message["photo"], key=lambda size: size.get("file_size") or size.get("width", 0))
                content = self._fetch(biggest["file_id"], PHOTO_LOST)
                if content is not None:
                    self.finance.send_photo(content, message.get("caption") or "")
            elif command in STOP_WORDS:
                self._stop()
            elif command == "/new":
                self.finance.new_chat()
                self.say(NEW_CHAT)
            elif command == "/start":
                self.say(HELLO)
            elif message.get("text"):
                posted = self.finance.send(message["text"])
                if posted.get("card") and posted["status"] == "done":
                    self.show_card(posted["card"])  # a typed yes or no, already settled
            elif any(message.get(kind) for kind in UNREADABLE):
                self.say(NOT_UNDERSTOOD)
            # Anything else is Telegram's own business (someone joined, a message was pinned): no reply.
        except AppDown as e:
            self.say(e.message)

    def _stop(self) -> None:
        if not self.finance.stop():
            self.say(NOTHING_TO_STOP)
            return
        for log in list(self._logs.values()):  # said at once, not at the next look at the app
            text, _ = render_log(log.get("steps", []), "stopping", log.get("heard"))
            if log["text"] != text:
                self.edit(log["message_id"], text, None)
                log["text"] = text

    def _acknowledge(self, query: dict) -> None:
        """Stop the button's spinner. A press that arrives late is still a press, so failing here is fine."""
        try:
            self.telegram.call("answerCallbackQuery", callback_query_id=query["id"])
        except TELEGRAM_FAILED:
            logger.info("too late to acknowledge a button press")

    def on_callback(self, query: dict) -> None:
        self._acknowledge(query)
        if not self.is_allowed(query.get("from"), (query.get("message") or {}).get("chat")):
            return
        message_id = query["message"]["message_id"]
        action, _, rest = (query.get("data") or "").partition(":")
        if action == "s":
            try:
                self._stop()
            except AppDown as e:
                self.say(e.message)
            return
        raw_id, _, version = rest.partition(":")
        if not raw_id.isdigit():
            return
        item = int(raw_id)
        try:
            if action == "c":
                self.edit(message_id, query["message"].get("text", "Which one?"), None)
                self.finance.send(choose=item)
            elif action == "q":
                if version == "x":
                    self.finance.something_else(item)  # the app asks what it is, as a line of the conversation
                elif version.isdigit():
                    self.show_question(self.finance.answer(item, int(version)), [message_id])
            elif action == "d":
                self.finance.show_all(item)
            else:
                self.show_card(self.finance.apply(item, version) if action == "a" else self.finance.reject(item))
        except AppDown as e:
            if action in ("c", "q", "d"):
                self.say(e.message)
            else:
                text = e.message if e.unknown else f"That didn't go through, and nothing changed.\n\n{e.message}"
                self.edit(message_id, text, [[{"text": "Try again", "callback_data": query["data"]}]])

    def run(self) -> None:
        if self.group is not None:
            threading.Thread(target=self.pump_forever, name="deliver", daemon=True).start()
        offset = None
        with ThreadPoolExecutor(max_workers=4) as pool:
            while True:
                try:
                    params = {"timeout": POLL_SECONDS, "allowed_updates": ["message", "callback_query"]}
                    if offset is not None:
                        params["offset"] = offset
                    updates = self.telegram.get_updates(**params)
                except httpx.TimeoutException:
                    continue
                except (RuntimeError, httpx.HTTPError, ValueError) as e:
                    logger.warning("polling Telegram failed: %s", type(e).__name__)
                    time.sleep(3)
                    continue
                for update in updates:
                    offset = update["update_id"] + 1
                    if "message" in update:
                        pool.submit(self._safely, self.on_message, update["message"])
                    elif "callback_query" in update:
                        pool.submit(self._safely, self.on_callback, update["callback_query"])

    @staticmethod
    def _safely(handler, payload) -> None:
        try:
            handler(payload)
        except Exception:
            logger.exception("handling a Telegram update failed")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its request log contains the token
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    # TELEGRAM_ALLOWED_USER_ID is the earlier name, from when the bot answered one account.
    allowed = [part.strip() for part in (os.getenv("TELEGRAM_ALLOWED_USER_IDS") or os.getenv("TELEGRAM_ALLOWED_USER_ID", "")).split(",") if part.strip()]
    group = os.getenv("TELEGRAM_GROUP_ID", "").strip()
    if not token or not allowed or not all(part.isdigit() for part in allowed):
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS (the household's numeric Telegram user ids, comma-separated).")
    if group and not group.lstrip("-").isdigit():
        sys.exit("TELEGRAM_GROUP_ID must be the group's numeric id, such as -1001234567890.")
    telegram = Telegram(token, os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/"))
    finance = Finance(os.getenv("FINANCE_API_URL", "http://127.0.0.1:18600/api"))
    if group:
        logger.info("Finance bot started")
    else:
        logger.warning("TELEGRAM_GROUP_ID is not set: answering nobody. Write in the group and its id is logged here.")
    Bot(telegram, finance, {int(part) for part in allowed}, int(group) if group else None).run()


if __name__ == "__main__":
    main()
