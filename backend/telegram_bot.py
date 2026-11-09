"""The private Telegram bot: a thin front on the app's own chat API, so both chats act the same.

Runs as its own process (deploy/household-finance-telegram.service). Answers one Telegram account
only; everyone else gets silence. Message contents are never logged.

Needs TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID; FINANCE_API_URL points at the app.
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
DIGGING = "Looking through the history. This can take a few minutes."
CHART_LOST = "The chart could not be sent this time."
NOT_A_FILE = "Send an ING CSV as a file, or say what happened in words."
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


def eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, rem = divmod(abs(cents), 100)
    return f"{sign}€{whole:,}".replace(",", ".") + f",{rem:02d}"


def _effect_lines(card: dict, applied: bool) -> list[str]:
    lines = []
    for item in card["effect"]:
        planned = f" of {eur(item['planned_cents'])}" if item["planned_cents"] is not None else ""
        label = f"{item['category']} {item['when']}"
        if applied:
            lines.append(f"{label}: {eur(item['after_cents'])}{planned}")
        else:
            lines.append(f"{label}: {eur(item['before_cents'])} → {eur(item['after_cents'])}{planned}")
    return lines


def render_card(card: dict) -> tuple[str, list | None]:
    """The card as text, and its buttons (None once there is nothing left to decide)."""
    status = card["status"]
    if status == "applied":
        return "\n".join([f"Applied. {card['result']['text']}", "", *_effect_lines(card, applied=True)]), None
    if status == "rejected":
        return ("Kept both. Nothing changed." if card["reject_label"] == "Keep both"
                else "Not applied. Nothing changed."), None
    if status == "superseded":
        return "Replaced by a newer suggestion. Nothing changed.", None
    if status == "failed":
        text = f"That didn't go through, and nothing changed.\n\n{card['error']}"
        return text, [[{"text": "Try again", "callback_data": f"a:{card['id']}:{card['version']}"}]]

    lines = [card["heading"], "", card["summary"]]
    if card["note"]:
        lines += ["", card["note"]]
    for change in card["changes"]:
        lines += ["", change["title"], ""]
        lines += [f"{f['label']}: {f['before']} → {f['after']}" for f in change["fields"]]
    if card["purchase"]:
        purchase = card["purchase"]
        lines += ["", f"Refund for: {purchase['description']}, {purchase['date_label']} ({purchase['amount_label']})"]
    effects = _effect_lines(card, applied=False)
    if effects:
        lines += ["", *effects]
    buttons = [[
        {"text": card["apply_label"], "callback_data": f"a:{card['id']}:{card['version']}"},
        {"text": card["reject_label"], "callback_data": f"r:{card['id']}"},
    ]]
    return "\n".join(lines), buttons


def render_import(counts: dict) -> str:
    return "\n".join([
        "ING import",
        "",
        f"New: {counts['imported']}",
        f"Already here, skipped: {counts['skipped']}",
        f"Sorted by rules: {counts['by_rule']}",
        f"Guesses to review: {counts['by_ai']}",
        f"Couldn't be sorted: {counts['uncategorised']}",
    ])


def _chunks(text: str) -> list[str]:
    return [text[i:i + TEXT_LIMIT] for i in range(0, len(text), TEXT_LIMIT)] or [" "]


def _option_label(option: dict) -> str:
    return f"{option['date_label']} · {option['amount_label']} · {option['description']}"


class Bot:
    def __init__(self, telegram: Telegram, finance: Finance, allowed_user_id: int):
        self.telegram = telegram
        self.finance = finance
        self.allowed = allowed_user_id
        self._told_waiting: set[int] = set()
        self._told_digging: set[int] = set()
        self._in_flight: list[dict] = []
        self._told_lost = False
        self._last_typing = 0.0

    def is_allowed(self, sender: dict | None, chat: dict | None) -> bool:
        return bool(
            sender and chat and sender.get("id") == self.allowed
            and chat.get("id") == self.allowed and chat.get("type") == "private"
        )

    def _send(self, chunk: str, buttons: list | None) -> int:
        params = {"chat_id": self.allowed, "text": chunk}
        if buttons:
            params["reply_markup"] = {"inline_keyboard": buttons}
        return self.telegram.call("sendMessage", **params)["message_id"]

    def say(self, text: str, buttons: list | None = None) -> list[int]:
        """Send text, in several messages if long. Buttons go on the last one."""
        chunks = _chunks(text)
        return [self._send(chunk, buttons if i == len(chunks) - 1 else None) for i, chunk in enumerate(chunks)]

    def edit(self, message_id: int, text: str, buttons: list | None) -> None:
        params = {"chat_id": self.allowed, "message_id": message_id, "text": text[:TEXT_LIMIT]}
        params["reply_markup"] = {"inline_keyboard": buttons or []}
        try:
            self.telegram.call("editMessageText", **params)
        except RuntimeError:
            logger.info("could not edit a card; it was probably already up to date")

    def show_card(self, card: dict) -> list[int]:
        """Show a card, replacing every Telegram message that already shows it."""
        text, buttons = render_card(card)
        chunks = _chunks(text)
        shown = list(card["message_ids"])
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
                self.telegram.call("deleteMessage", chat_id=self.allowed, message_id=extra)
            except RuntimeError:
                logger.info("could not delete an old part of a card")
        if shown and ids != shown:
            self.finance.delivered(card["message_id"], ids)
        return ids

    def show_reply(self, reply: dict) -> list[int]:
        if reply["kind"] == "proposal":
            return self.show_card(reply["card"])
        if reply["kind"] == "import":
            return self.say(render_import(reply["payload"]))
        if reply["kind"] == "clarify":
            options = (reply.get("payload") or {}).get("options", [])
            lines = [reply["text"], "", *[f"• {_option_label(o)}" for o in options]]
            buttons = [[{"text": _option_label(o)[:60], "callback_data": f"c:{o['id']}"}] for o in options]
            return self.say("\n".join(lines), buttons or None)
        ids = self.say(reply["text"])
        if (reply.get("payload") or {}).get("chart"):
            ids += self._send_chart(reply["id"])
        return ids

    def _send_chart(self, message_id: int) -> list[int]:
        """The picture beside the words. The words are already out, so a failure here must not resend them."""
        try:
            return [self.telegram.send_photo(self.allowed, self.finance.chart(message_id))["message_id"]]
        except (AppDown, *TELEGRAM_FAILED):
            logger.warning("a chart could not be sent")
        try:
            return self.say(CHART_LOST)
        except TELEGRAM_FAILED:
            return []

    def pump_once(self) -> None:
        """Show every reply not shown yet, and say so when a message is waiting its turn."""
        box = self.finance.outbox()
        self._told_lost = False
        self._in_flight = box["in_flight"]
        for reply in box["replies"]:
            self.finance.delivered(reply["id"], self.show_reply(reply))
        for item in self._in_flight:
            late = item["status"] == "queued" and item["age_seconds"] >= WAIT_NOTE_AFTER_SECONDS
            if (item["status"] == "waiting" or late) and item["id"] not in self._told_waiting:
                self._told_waiting.add(item["id"])
                self.say(WAITING)
            if item["status"] == "digging" and item["id"] not in self._told_digging:
                self._told_digging.add(item["id"])
                self.say(DIGGING)
        if self._in_flight and time.monotonic() - self._last_typing > 4:
            self._last_typing = time.monotonic()
            self.telegram.call("sendChatAction", chat_id=self.allowed, action="typing")

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

    def on_message(self, message: dict) -> None:
        if not self.is_allowed(message.get("from"), message.get("chat")):
            return
        try:
            if message.get("document"):
                document = message["document"]
                try:
                    content = self.telegram.download(document["file_id"])
                except TELEGRAM_FAILED:
                    self.say("That file could not be used because Telegram would not hand it over. Nothing was imported.")
                    return
                self._safely(lambda _: self.say(READING), None)  # the file matters more than the notice
                self.finance.send_file(document.get("file_name") or "bank file", content)
            elif message.get("text"):
                posted = self.finance.send(message["text"])
                if posted.get("card") and posted["status"] == "done":
                    self.show_card(posted["card"])  # a typed yes or no, already settled
            else:
                self.say(NOT_A_FILE)
        except AppDown as e:
            self.say(e.message)

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
        raw_id, _, version = rest.partition(":")
        if not raw_id.isdigit():
            return
        item = int(raw_id)
        try:
            if action == "c":
                self.edit(message_id, query["message"].get("text", "Which one?"), None)
                self.finance.send(choose=item)
                return
            self.show_card(self.finance.apply(item, version) if action == "a" else self.finance.reject(item))
        except AppDown as e:
            if action == "c":
                self.say(e.message)
            else:
                text = e.message if e.unknown else f"That didn't go through, and nothing changed.\n\n{e.message}"
                self.edit(message_id, text, [[{"text": "Try again", "callback_data": query["data"]}]])

    def run(self) -> None:
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
    allowed = os.getenv("TELEGRAM_ALLOWED_USER_ID", "")
    if not token or not allowed.isdigit():
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID (a numeric Telegram user id).")
    telegram = Telegram(token, os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/"))
    finance = Finance(os.getenv("FINANCE_API_URL", "http://127.0.0.1:18600/api"))
    logger.info("Finance bot started")
    Bot(telegram, finance, int(allowed)).run()


if __name__ == "__main__":
    main()
