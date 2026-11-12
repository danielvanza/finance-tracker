"""The tools Claude can call while it works on a reply, served to that one run and to nothing else.

Claude runs in its sandbox with no built-in tools. These reach it as a small MCP server on loopback that
lives for one reply, guarded by a token. Lookups read the Month page's figures or a private copy of the
ledger; a suggested change only becomes a card, which a person has to Apply. Nothing here changes data.
"""
import json
import logging
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Literal

from pydantic import BaseModel, Field, ValidationError

from assistant import charts, queries
from assistant.actions import OPS
from assistant.figures import reads_like_a_query
from assistant.queries import ROW_CAP, SCHEMA, Views

logger = logging.getLogger(__name__)

SERVER_NAME = "finance"
MAX_STEP = 90
MAX_CHOICES = 10
WORK_RESULT_CHARS = 6000  # of each lookup, kept for writing up what was found if the reply is stopped
_MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
_DOING = (
    "What you are doing, in a few plain words the person sees in the live log, such as "
    "'Checking groceries over the last six months'. No query text, table or column names."
)


class MonthOverview(BaseModel):
    doing: str = Field(description=_DOING)
    month: str | None = Field(default=None, pattern=_MONTH, description="YYYY-MM, or leave out for the current financial month.")


class RunQuery(BaseModel):
    doing: str = Field(description=_DOING)
    queries: list[str] = Field(min_length=1, max_length=3, description="One to three SQLite SELECT statements.")


class ProposeChange(BaseModel):
    summary: str = Field(pattern=r"\S", description="One plain sentence saying what will change, shown at the top of the card.")
    op: str = Field(description="The name of the change.")
    args: dict = Field(description="Its arguments, with ids you looked up.")
    note: str | None = Field(default=None, description="One short sentence, only if something would surprise the person.")
    replaces: list[int] = Field(default=[], description=(
        "Ids of earlier cards this one corrects or takes the place of; they are withdrawn. Other cards stay as they are."
    ))


class ShowChoices(BaseModel):
    transaction_ids: list[int] = Field(min_length=2, max_length=MAX_CHOICES, description="The rows to choose between.")


class ShowChart(BaseModel):
    query: str = Field(description="The id of a run_query result to draw, such as q3.")
    type: Literal["line", "bars"]
    x: str = Field(description="Column for the x axis, usually month.")
    y: str = Field(description="Numeric column to draw, ending in _cents, _eur, _pct or _count.")
    series: str | None = Field(default=None, description="Column that splits the lines or bars, such as category.")
    title: str = Field(default="", description="Plain words, no figures.")


_OPERATIONS = "\n".join(f"- {name}: {op.signature}" for name, op in OPS.items())
_TOOLS = {
    "month_overview": (MonthOverview, (
        "One financial month exactly as the Month page shows it: what is free to spend until payday and per day, the "
        "fixed bills still to come and set-asides it allows for, against plan by now, needs, wants and savings, and "
        "each budget category spent against planned, with category ids. Use it for any "
        "question about how a month stands; its figures are the ones people compare with the page."
    )),
    "run_query": (RunQuery, (
        "Read anything in the household's finances with read-only SQLite SELECTs, as often as you need: history, "
        "single rows and their ids, payments waiting for an answer, plans, rules, set-asides and savings goals. "
        f"Each result has at most {ROW_CAP} rows; one marked cut_off is incomplete, so narrow it with WHERE, GROUP BY, "
        "LIMIT and OFFSET. Work sums, differences and averages out in SQL. Name numeric columns for their unit: *_cents, "
        "*_eur, *_pct or *_count. Every response also says where the data has gaps. Nothing can be changed through "
        "this tool and these are the only tables:\n" + SCHEMA
    )),
    "propose_change": (ProposeChange, (
        "Show the person a card with a change they asked for. The app works out exactly what would change and shows "
        "it; nothing happens until they press Apply. If the app cannot make the change as given, the result says why: "
        "correct it and call again, or ask the person. You can make several cards in one reply. "
        "The changes the app can make:\n" + _OPERATIONS
    )),
    "show_choices": (ShowChoices, (
        "Put the rows you are asking about under your reply as buttons, so the person can tap the one they mean. "
        "Your reply text asks the question."
    )),
    "show_chart": (ShowChart, (
        "Show a chart under your reply, drawn by the app from one run_query result. Use it when a picture helps, and "
        "always when the person asks to see, show, chart, plot or graph something. Quote the same figures in your "
        "words. The last chart you ask for in a reply is the one shown."
    )),
}


def _for_claude(result: dict) -> dict:
    if "rows" not in result:
        return result
    labelled = [[f"r{i}", *row] for i, row in enumerate(result["rows"], 1)]
    return {**result, "columns": ["row", *result["columns"]], "rows": labelled}


def plain_step(doing: str, fallback: str) -> str:
    """What the live log says: Claude's words if they are plain, never query text."""
    words = " ".join(doing.split())
    if not words or reads_like_a_query(words):
        return fallback
    return words if len(words) <= MAX_STEP else words[:MAX_STEP - 1] + "…"


class Toolbox:
    """One reply's tools and everything they have found so far.

    on_step(text) puts a line in the live log. propose(call) turns a suggested change into a card and returns
    None, or the reason the app would not take it.
    """

    def __init__(self, on_step: Callable[[str], None], propose: Callable[[ProposeChange], str | None]) -> None:
        self._on_step = on_step
        self._propose = propose
        self._lock = threading.Lock()
        self._views: Views | None = None
        self._results: list[dict] = []
        self.work: list[dict] = []  # each lookup and what it found, in order
        self.cards = 0
        self.lookups = 0  # each overview and each query, however they were grouped into calls
        self.chart: dict | None = None
        self.choices: list[int] = []
        self._token = secrets.token_urlsafe(32)
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, name="chat-tools", daemon=True)

    def __enter__(self) -> "Toolbox":
        self._thread.start()
        return self

    def __exit__(self, *_) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
        if self._views is not None:
            self._views.close()

    @property
    def config(self) -> dict:
        """What the CLI needs to reach these tools."""
        return {"mcpServers": {SERVER_NAME: {
            "type": "http", "url": f"http://127.0.0.1:{self._server.server_address[1]}/mcp",
            "headers": {"Authorization": f"Bearer {self._token}"},
        }}}

    @staticmethod
    def allowed_tools() -> list[str]:
        return [f"mcp__{SERVER_NAME}__{name}" for name in _TOOLS]

    def _found(self, doing: str, result: str) -> None:
        self.work.append({"looked_up": doing, "found": result[:WORK_RESULT_CHARS]})

    # ---- The tools ------------------------------------------------------------------------------

    def _month_overview(self, call: MonthOverview) -> tuple[str, bool]:
        step = plain_step(call.doing, "Looking at the month")
        self._on_step(step)
        self.lookups += 1
        try:
            text = json.dumps(queries.month_overview(call.month), ensure_ascii=False)
        except Exception:
            logger.exception("[chat] reading a month failed")
            self._found(step, "This lookup failed.")
            return "This lookup failed, so there are no figures from it. Say so plainly rather than guess.", True
        self._found(step, text)
        return text, False

    def _run_query(self, call: RunQuery) -> tuple[str, bool]:
        step = plain_step(call.doing, "Looking through the history")
        self._on_step(step)
        if self._views is None:
            try:
                self._views = Views()
            except Exception:
                logger.exception("[chat] preparing the history failed")
                self._found(step, "The history could not be read.")
                return "The history could not be read, so there are no figures from it. Say so plainly rather than guess.", True
        fresh = [self._views.run(f"q{len(self._results) + i + 1}", sql) for i, sql in enumerate(call.queries)]
        self._results += fresh
        self.lookups += len(fresh)
        text = json.dumps({"coverage": self._views.coverage_note(), "results": [_for_claude(r) for r in fresh]}, ensure_ascii=False)
        self._found(step, text)
        return text, False

    def _propose_change(self, call: ProposeChange) -> tuple[str, bool]:
        self._on_step(plain_step(f"Preparing a card: {call.summary}", "Preparing a card"))
        problem = self._propose(call)
        if problem:
            self._on_step("The app would not take that as it was, so I am correcting it")
            return f"No card was shown, because the app would not take this: {problem}", True
        self.cards += 1
        return "The card is shown. Nothing changes unless the person presses Apply.", False

    def _show_choices(self, call: ShowChoices) -> tuple[str, bool]:
        self.choices = list(dict.fromkeys(call.transaction_ids))
        return "The rows will be shown as buttons under your reply.", False

    def _show_chart(self, call: ShowChart) -> tuple[str, bool]:
        self._on_step("Drawing a chart")
        try:
            chart = charts.prepare(call.model_dump(), self._results)
            if chart is None:
                return "There is only one number there, so say it rather than draw it.", True
            charts.render(chart)  # proves it can be drawn before the words promise it
        except charts.ChartProblem as e:
            return f"That chart cannot be drawn: {e}.", True
        except Exception as e:  # whatever goes wrong with a picture, the words still go out
            logger.warning("[chat] a chart could not be made: %s", type(e).__name__)
            return "That chart could not be drawn. Leave it out and say so in a few words.", True
        self.chart = chart
        return "The chart will be shown under your reply.", False

    # ---- Speaking MCP ---------------------------------------------------------------------------

    def _call_tool(self, name: str, arguments: dict) -> tuple[str, bool]:
        if name not in _TOOLS:
            return f"There is no tool called {name}.", True
        model, _ = _TOOLS[name]
        try:
            call = model.model_validate(arguments)
        except ValidationError as e:
            return "Those arguments don't fit: " + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()), True
        return getattr(self, f"_{name}")(call)

    def _respond(self, method: str, params: dict) -> dict:
        if method == "initialize":
            return {"protocolVersion": params.get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}},
                    "serverInfo": {"name": SERVER_NAME, "version": "2"}}
        if method == "tools/list":
            return {"tools": [
                {"name": name, "description": description, "inputSchema": model.model_json_schema()}
                for name, (model, description) in _TOOLS.items()
            ]}
        if method == "tools/call":
            with self._lock:
                text, is_error = self._call_tool(params.get("name", ""), params.get("arguments") or {})
            return {"content": [{"type": "text", "text": text}], "isError": is_error}
        return {}

    def _handler(self):
        toolbox = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):  # queries and results stay out of the logs
                pass

            def _send(self, status: int, body: dict | None = None) -> None:
                payload = json.dumps(body).encode() if body is not None else b""
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                self._send(405)

            def do_DELETE(self):
                self._send(405)

            def do_POST(self):
                if self.headers.get("Authorization") != f"Bearer {toolbox._token}":
                    self._send(401)
                    return
                message = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                if "id" not in message:
                    self._send(202)
                    return
                self._send(200, {
                    "jsonrpc": "2.0", "id": message["id"],
                    "result": toolbox._respond(message.get("method", ""), message.get("params") or {}),
                })

        return Handler
