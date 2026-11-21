"""Files made in the chat: the CSV, the export_file tool, the download route, pruning and the Telegram document."""
from datetime import date, datetime
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import clock
import exports
import telegram_bot
from assistant import bot, queries
from botkit.telegram import Settings
from db import get_db
from models import Category, Export, Transaction
from routers import exports as exports_router
from seed import run_seed

NOW = datetime(2026, 11, 21, 10, 0)


# ---- The CSV ------------------------------------------------------------------------------------------------------

def test_csv_opens_in_a_dutch_spreadsheet():
    content = exports.to_csv(
        ["date", "description", "amount_cents", "share_pct", "note"],
        [("2026-11-03", "Albert Heijn; Utrecht", -1234, 12.5, None),
         (date(2026, 11, 4), 'Café "Zon"', 250000, 3.0, "=HYPERLINK(1)"),
         ("2026-11-05", "Refund", 5, 0.25, "-flight")],
    )
    assert content.startswith(b"\xef\xbb\xbf")  # UTF-8 with a byte order mark, so Excel reads the accents
    lines = content.decode("utf-8-sig").split("\r\n")
    assert lines[0] == "date;description;amount_eur;share_pct;note"
    assert lines[1] == '2026-11-03;"Albert Heijn; Utrecht";-12,34;12,5;'
    assert lines[2] == '2026-11-04;"Café ""Zon""";2500,00;3;\'=HYPERLINK(1)'
    assert lines[3] == "2026-11-05;Refund;0,05;0,25;'-flight"


def test_cents_that_are_averages_or_empty_become_plain_euros():
    content = exports.to_csv(["month", "avg_spent_cents"], [("2026-10", 1050.6), ("2026-11", None)])
    assert content.decode("utf-8-sig").split("\r\n")[1:3] == ["2026-10;10,51", "2026-11;"]


@pytest.mark.parametrize("given, kept", [
    ("Groceries 2026", "Groceries 2026.csv"),
    ("../../etc/passwd", "etc passwd.csv"),
    ("Boodschappen: café!.CSV", "Boodschappen café.csv"),
    ("", "export.csv"),
    ("x" * 200, "x" * exports.MAX_NAME + ".csv"),
])
def test_a_file_name_is_plain_words(given, kept):
    assert exports.clean_filename(given) == kept


# ---- Keeping files ------------------------------------------------------------------------------------------------

def test_a_new_file_clears_out_ones_older_than_thirty_days(db, monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: NOW)
    db.add_all([
        Export(filename="old.csv", content=b"a", created_at=datetime(2026, 10, 21, 9, 59)),
        Export(filename="recent.csv", content=b"b", created_at=datetime(2026, 10, 22, 10, 0)),
    ])
    db.commit()
    saved = exports.save(db, "Groceries", b"c")
    assert saved.filename == "Groceries.csv" and saved.created_at == NOW
    assert sorted(e.filename for e in db.query(Export).all()) == ["Groceries.csv", "recent.csv"]


# ---- The tool -----------------------------------------------------------------------------------------------------

class FakeToolContext:
    def __init__(self):
        self.state, self.attached, self.closers = {}, {}, []

    def on_close(self, fn):
        self.closers.append(fn)

    def attach(self, **payload):
        self.attached.update(payload)

    def close(self):
        for fn in reversed(self.closers):
            fn()


@pytest.fixture
def ledger(db, monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: NOW)
    sessions = sessionmaker(bind=db.get_bind())
    monkeypatch.setattr(queries, "SessionLocal", sessions)
    monkeypatch.setattr(bot, "SessionLocal", sessions)
    run_seed(db)
    groceries = db.query(Category).filter_by(name="Food - Essential").one()
    for day, euros, name in [(3, "-12.34", "Albert Heijn"), (5, "-1234.50", "Jumbo"), (9, "-0.99", "Lidl " + "x" * 130)]:
        db.add(Transaction(date=date(2026, 11, day), amount=Decimal(euros), description=name, source="ing",
                           category_id=groceries.id, confirmed=True, import_hash=f"h{day}"))
    db.commit()
    ctx = FakeToolContext()
    yield ctx
    ctx.close()


GROCERIES = ("SELECT date, description, amount_cents FROM transactions WHERE category = 'Food - Essential' "
             "ORDER BY date")


def test_export_file_stores_the_file_and_attaches_it(db, ledger):
    told = bot._export_file({"doing": "x", "query": GROCERIES, "filename": "Groceries / 2026",
                             "title": "Groceries this year"}, ledger)
    assert isinstance(told, str) and "3 rows" in told and "amount_eur" in told
    export = ledger.attached["export"]
    assert export["filename"] == "Groceries 2026.csv" and export["rows"] == 3 and export["cut_off"] is False
    assert export["columns"] == ["date", "description", "amount_eur"] and export["title"] == "Groceries this year"
    saved = db.get(Export, export["id"])
    lines = saved.content.decode("utf-8-sig").split("\r\n")
    assert lines[:3] == ["date;description;amount_eur", "2026-11-03;Albert Heijn;-12,34", "2026-11-05;Jumbo;-1234,50"]
    assert lines[3] == "2026-11-09;Lidl " + "x" * 130 + ";-0,99"


def test_export_file_keeps_long_text_whole(ledger, db):
    bot._export_file({"doing": "x", "query": "SELECT group_concat(description, ' | ') AS shops FROM transactions",
                      "filename": "shops"}, ledger)
    shops = db.get(Export, ledger.attached["export"]["id"]).content.decode("utf-8-sig").split("\r\n")[1]
    assert len(shops) > queries.MAX_TEXT and shops.endswith("x" * 130)  # run_query would cut it at MAX_TEXT


def test_export_file_says_when_it_is_cut_off(ledger, monkeypatch):
    monkeypatch.setattr(bot, "EXPORT_ROW_CAP", 2)
    told = bot._export_file({"doing": "x", "query": GROCERIES, "filename": "g"}, ledger)
    assert "cut off at 2 rows" in told
    assert ledger.attached["export"]["rows"] == 2 and ledger.attached["export"]["cut_off"] is True


@pytest.mark.parametrize("query, says", [
    ("SELECT * FROM chat_messages", "no such table"),
    ("DELETE FROM transactions", "Refused"),
    ("SELECT date FROM transactions WHERE category = 'Nothing'", "nothing matched"),
])
def test_export_file_errors_go_back_to_claude(db, ledger, query, says):
    told, is_error = bot._export_file({"doing": "x", "query": query, "filename": "f"}, ledger)
    assert is_error and told.startswith(bot.NO_FILE) and says in told
    assert "export" not in ledger.attached and db.query(Export).count() == 0


def test_an_answer_with_a_file_shows_it_in_the_conversation():
    entry = bot.history_entry({"kind": "answer", "role": "assistant", "text": "Here it is.",
                               "payload": {"export": {"id": 4, "filename": "Groceries.csv", "rows": 12}}})
    assert entry["file_sent"] == "Groceries.csv (12 rows)"


def test_export_file_is_a_tool():
    tool = next(t for t in bot.TOOLS if t.name == "export_file")
    assert set(tool.input_schema["required"]) == {"doing", "query", "filename"}


# ---- The route ----------------------------------------------------------------------------------------------------

def test_the_route_serves_the_file_as_a_download(db):
    db.add(Export(id=3, filename="Boodschappen café.csv", content=b"\xef\xbb\xbfdate\r\n", created_at=NOW))
    db.commit()
    app = FastAPI()
    app.include_router(exports_router.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    response = client.get("/exports/3")
    assert response.status_code == 200 and response.content == b"\xef\xbb\xbfdate\r\n"
    assert response.headers["content-type"].startswith("text/csv")
    disposition = response.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="Boodschappen caf_.csv"')
    assert "filename*=UTF-8''Boodschappen%20caf%C3%A9.csv" in disposition
    assert client.get("/exports/99").status_code == 404


# ---- Telegram -----------------------------------------------------------------------------------------------------

class FakeTelegram:
    def __init__(self, fail_document=False):
        self.calls, self.documents, self.fail_document, self._next = [], [], fail_document, 100

    def _id(self):
        self._next += 1
        return {"message_id": self._next}

    def call(self, method, **params):
        self.calls.append((method, params))
        return self._id()

    def send_document(self, chat_id, content, name, caption=""):
        if self.fail_document:
            raise RuntimeError("sendDocument: Bad Request")
        self.documents.append((chat_id, content, name, caption))
        return self._id()


def front(telegram, handler):
    files = httpx.Client(transport=httpx.MockTransport(handler))
    return telegram_bot.FinanceFront(
        Settings(api_url="http://app/api/chat", token="t", allowed_user_ids={1}, group_id=-5),
        renderers=telegram_bot.RENDERERS, texts=telegram_bot.TEXTS, telegram=telegram, api=object(),
        exports_url="http://app/api/", files=files,
    )


ANSWER = {"id": 9, "kind": "answer", "role": "assistant", "text": "Here are this year's groceries.",
          "payload": {"export": {"id": 4, "filename": "Groceries 2026.csv", "rows": 1234, "title": "Groceries"}}}


def test_telegram_sends_the_file_after_the_words():
    asked = []

    def handler(request):
        asked.append(str(request.url))
        return httpx.Response(200, content=b"csv bytes")

    telegram = FakeTelegram()
    ids = front(telegram, handler).show_reply(ANSWER)
    assert asked == ["http://app/api/exports/4"]
    assert [m for m, _ in telegram.calls] == ["sendMessage"]
    assert telegram.calls[0][1]["text"] == "Here are this year's groceries."
    assert telegram.documents == [(-5, b"csv bytes", "Groceries 2026.csv", "Groceries · 1.234 rows")]
    assert ids == [101, 102]


@pytest.mark.parametrize("app_status, fail_document", [(404, False), (200, True)])
def test_telegram_says_in_one_line_when_the_file_cannot_be_sent(app_status, fail_document):
    telegram = FakeTelegram(fail_document=fail_document)
    ids = front(telegram, lambda request: httpx.Response(app_status, content=b"x")).show_reply(ANSWER)
    texts = [params["text"] for method, params in telegram.calls if method == "sendMessage"]
    assert texts == ["Here are this year's groceries.", telegram_bot.FILE_LOST]  # the words go once
    assert telegram.documents == [] and len(ids) == 2


def test_telegram_keeps_the_file_when_the_words_are_edited():
    telegram = FakeTelegram()
    ids = front(telegram, lambda request: httpx.Response(200)).show_again(ANSWER, [101, 102])
    assert ids == [101, 102] and not any(method == "deleteMessage" for method, _ in telegram.calls)


def test_a_file_caption_counts_its_rows():
    assert telegram_bot.file_caption({"rows": 1}) == "1 row"
    assert telegram_bot.file_caption({"rows": 20000, "cut_off": True}) == "The first 20.000 rows"


def test_the_real_telegram_client_sends_a_document_as_multipart():
    seen = {}

    def handler(request):
        seen["url"], seen["body"] = str(request.url), request.read()
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 7}})

    client = telegram_bot.FinanceTelegram("TOKEN", "http://tg")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    assert client.send_document(-5, b"a;b", "g.csv", "2 rows")["message_id"] == 7
    assert seen["url"] == "http://tg/botTOKEN/sendDocument"
    assert b'name="document"; filename="g.csv"' in seen["body"] and b"a;b" in seen["body"]
    assert b"2 rows" in seen["body"]
