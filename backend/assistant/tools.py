"""The tools Claude can call while answering, served to that one run and to nothing else.

Claude runs in its sandbox with no built-in tools. These reach it as a small MCP server on loopback that
lives for one question, guarded by a token. They read a private copy of the ledger and record a reply;
none of them can change anything.
"""
import json
import logging
import secrets
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Annotated, Literal

from pydantic import BaseModel, Field, ValidationError

from assistant import charts, figures
from assistant.actions import OPS
from assistant.queries import ROW_CAP, SCHEMA, Views, merchant_key

logger = logging.getLogger(__name__)

SERVER_NAME = "finance"
MAX_ROUNDS = 5
LAST_CALL_SECONDS = 60  # with less than this left, Claude must answer from what it has
_MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
_WHOLE_SCOPES = ("all categories", "all merchants", "all payments")

NOTHING_TO_READ = "I could not read the history just now, so I have no figures for that. Nothing changed."
CANNOT_VOUCH = "I could not back up every figure in that answer from the data, so I am not giving one. Nothing changed."
STOPPED_NOTE = "I stopped early, so this answer is partial."
STOPPED_EMPTY = "I stopped early, before I had an answer I could stand behind, so this is partial: no figures. Nothing changed."
UNFINISHED = "I could not finish working that out, so I have no figures to give. Nothing changed."
CUT_OFF_NOTE = "Part of the data was cut off, so this is not the complete list."
CUT_OFF_ELSEWHERE_NOTE = "An earlier lookup was cut off, so this may not be the full picture."
CHART_FAILED_NOTE = "The chart could not be made this time."
_REFUNDS = {"netted_off": "refunds netted off", "not_netted_off": "refunds not netted off"}


class Answer(BaseModel):
    text: str = Field(pattern=r"\S", description="The whole reply, in the household's voice.")


class Clarify(BaseModel):
    text: str = Field(pattern=r"\S", description="The question to ask.")
    transaction_ids: list[int] = Field(
        default=[], description="The rows to choose between, or empty if the question is about something else.",
    )


class Propose(BaseModel):
    summary: str = Field(pattern=r"\S", description="One plain sentence saying what will change.")
    op: str = Field(description="The name of the change.")
    args: dict = Field(description="Its arguments, using ids that appear in the data.")
    note: str | None = Field(default=None, description="One short sentence, only if something would surprise the person.")


class RunQuery(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=3, description="One to three SQLite SELECT statements.")
    draft: dict | None = Field(default=None, description=(
        "From your second call on: your best answer so far, in the same shape as submit_insight. If time runs out "
        "before you submit, the person gets this draft, marked partial, instead of nothing."
    ))


class SubmitInsight(BaseModel):
    text: str = Field(pattern=r"\S", description=(
        "The answer. Every amount, count, percentage, month number and date is a reference to a result cell, written "
        "{q1.r3.spent_cents} for result q1, row r3, column spent_cents; the app fills in the value in the right format. "
        "Everything else is plain words, with lengths of time spelled out."
    ))
    scope: list[Annotated[str, Field(pattern=r"\S")]] = Field(min_length=1, description=(
        "The categories or merchants the answer covers, named as in the results, or one of: " + ", ".join(_WHOLE_SCOPES) + "."
    ))
    refunds: Literal["netted_off", "not_netted_off"] = Field(description="Whether refunds were subtracted from the figures.")
    first_month: str = Field(pattern=_MONTH, description="First month the person asked about, YYYY-MM, even if the data starts later.")
    last_month: str = Field(pattern=_MONTH, description="Last month the person asked about, YYYY-MM.")
    chart: dict | None = Field(description=(
        "Required: a chart, or null. Give a chart whenever the person says show, chart, plot or graph, and for any "
        "figure over several months; null only for answers without a trend over time. Keys: type (line or bars), "
        "query (the id of a result the text cites), x, y and optionally series (column names), title (plain words "
        "with no numbers). The app draws it from that result."
    ))


class CannotAnswer(BaseModel):
    text: str = Field(pattern=r"\S", description="A plain sentence saying what could not be worked out, with no figures.")


_OPERATIONS = "\n".join(f"- {name}: {op.signature}" for name, op in OPS.items())
_TOOLS = {
    "answer": (Answer, (
        "Reply from the data you were given: how one month stands, a simple lookup, or saying what the app cannot do. "
        "Ends your turn. Comparisons, trends, merchants, habits and repeating payments go through run_query and submit_insight instead."
    )),
    "ask_which": (Clarify, "Ask the person which row or detail they mean, when you cannot tell. Ends your turn."),
    "propose_change": (Propose, (
        "Suggest one change the person asked for: something to fix, add, move, book or set. A question, even about rows "
        "that look wrong, gets an answer instead, and the person can then ask for the change. The person sees exactly "
        "what would change and accepts or declines it; nothing happens until they do. Ends your turn. "
        "The changes the app can make:\n" + _OPERATIONS
    )),
    "run_query": (RunQuery, (
        "Read the household's history with read-only SQLite SELECTs. Use it for any month or row not in the data you "
        f"were given, and for every comparison, trend, merchant, habit or repeating payment. Up to {MAX_ROUNDS} calls per question; "
        "from the second call on, include a draft of your answer so far. "
        f"Each result has at most {ROW_CAP} rows, each labelled r1, r2, ... for citing in submit_insight; "
        "a result marked cut_off is incomplete, so narrow it with WHERE or GROUP BY. Work out differences, averages and percentages "
        "in the SQL so they come back as cells. Name every numeric column for its unit: *_cents, *_eur, *_pct or *_count, "
        "which sets how the app shows it. Every response also says where the data has gaps. "
        "Nothing can be changed through this tool and these are the only tables:\n" + SCHEMA
    )),
    "submit_insight": (SubmitInsight, (
        "Give the answer to a question you used run_query for. The app checks it, adds a line saying what it is based on "
        "and names any gaps in the period. If it replies with problems, fix them and call it again. Ends your turn once accepted."
    )),
    "cannot_answer": (CannotAnswer, "Say plainly that you could not work something out, after queries failed or the data is not there. Ends your turn."),
}


@dataclass
class Insight:
    """A finished answer from looking further back: the words as sent, and what to draw."""
    text: str
    chart: dict | None = None


def _for_claude(result: dict) -> dict:
    if "rows" not in result:
        return result
    labelled = [[f"r{i}", *row] for i, row in enumerate(result["rows"], 1)]
    return {**result, "columns": ["row", *result["columns"]], "rows": labelled}


class Toolbox:
    """One question's tools and everything they have gathered so far."""

    def __init__(self, seconds_left, on_digging) -> None:
        self._seconds_left = seconds_left
        self._on_digging = on_digging
        self._lock = threading.Lock()
        self._views: Views | None = None
        self._results: list[dict] = []
        self._rounds = 0
        self._draft: dict | None = None
        self._out_of_budget = False
        self._rejected = False
        self.decision: Answer | Clarify | Propose | Insight | None = None
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
    def dug(self) -> bool:
        return self._views is not None

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

    # ---- The tools ------------------------------------------------------------------------------

    def _run_query(self, call: RunQuery) -> tuple[str, bool]:
        if self._rounds >= MAX_ROUNDS or self._seconds_left() < LAST_CALL_SECONDS:
            self._out_of_budget = True
            return "The limit for this question has been reached. Call submit_insight now, from the results you already have.", True
        if self._views is None:
            try:
                self._views = Views()
            except Exception:
                logger.exception("[chat] preparing the history failed")
                self.decision = Insight(NOTHING_TO_READ)
                return "The history could not be read. Stop here.", True
            self._on_digging()
        if call.draft:
            self._draft = call.draft
        fresh = [self._views.run(f"q{len(self._results) + i + 1}", sql) for i, sql in enumerate(call.queries)]
        self._results += fresh
        self._rounds += 1
        return json.dumps({"coverage": self._views.coverage_note(), "results": [_for_claude(r) for r in fresh]}, ensure_ascii=False), False

    def _scope_problems(self, scope: list[str]) -> list[str]:
        known = self._views.names
        unknown = [
            name for name in scope if name.lower() not in _WHOLE_SCOPES and name.lower() not in known
            and not any(other.startswith(merchant_key(name) or name.lower()) for other in known)
        ]
        return [f"{unknown} are not categories or merchants in the data. Name them as the results do."] if unknown else []

    def _build(self, call: SubmitInsight, stopped: bool) -> tuple[Insight | None, list[str]]:
        """The answer as it is sent, or why it can't be."""
        if self._views is None:
            return None, ["Run a query first: there are no results to cite."]
        filled = figures.fill(call.text, self._results)
        title = str(call.chart.get("title") or "") if call.chart else ""
        names = self._views.names
        problems = filled.problems + figures.wording_problems(call.text, names) + figures.wording_problems(title, names)
        if not filled.cited:
            problems.append("Cite at least one result cell in the text.")
        problems += self._scope_problems(call.scope)
        if call.first_month > call.last_month:
            problems.append("first_month comes after last_month.")
        if problems:
            return None, problems

        parts = [filled.text.rstrip()]
        gaps = self._views.gaps_between(call.first_month, call.last_month)
        if gaps:
            parts.append(gaps)
        cited = [r for r in self._results if r["id"] in filled.cited]
        if any(r.get("cut_off") for r in cited):
            parts.append(CUT_OFF_NOTE)
        elif any(r.get("cut_off") for r in self._results):
            parts.append(CUT_OFF_ELSEWHERE_NOTE)
        if stopped:
            parts.append(STOPPED_NOTE)
        chart = None
        if call.chart:
            try:
                chart = charts.prepare(call.chart, cited)
                if chart is not None:
                    charts.render(chart)  # proves it can be drawn before the text promises it
            except Exception as e:  # whatever goes wrong with a picture, the words still go out
                logger.warning("[chat] a chart could not be made: %s", type(e).__name__)
                chart = None
                parts.append(CHART_FAILED_NOTE)
        parts.append(
            f"Based on: {', '.join(call.scope)}, {figures.period_name(call.first_month, call.last_month)}, {_REFUNDS[call.refunds]}."
        )
        return Insight("\n\n".join(parts), chart), []

    def _submit_insight(self, call: SubmitInsight) -> tuple[str, bool]:
        insight, problems = self._build(call, self._out_of_budget)
        if problems:
            self._rejected = True
            return "Not accepted. Fix these and call submit_insight again:\n- " + "\n- ".join(problems), True
        self.decision = insight
        return "Accepted. The person will see it. Stop here.", False

    def _cannot_answer(self, call: CannotAnswer) -> tuple[str, bool]:
        problems = figures.wording_problems(call.text, self._views.names if self._views else ())
        if problems:
            return "Not accepted. Fix these and call cannot_answer again:\n- " + "\n- ".join(problems), True
        notes = [CUT_OFF_NOTE] if any(r.get("cut_off") for r in self._results) else []
        self.decision = Insight("\n\n".join([call.text.rstrip(), *notes]))
        return "Recorded. Stop here.", False

    def _answer(self, call: Answer) -> tuple[str, bool]:
        if self.dug:
            return "After querying, use submit_insight, or cannot_answer if it could not be worked out.", True
        self.decision = call
        return "Sent. Stop here.", False

    def _ask_which(self, call: Clarify) -> tuple[str, bool]:
        if self.dug:
            problems = figures.wording_problems(call.text, self._views.names)
            if problems:
                return "Not accepted. Fix these and call ask_which again:\n- " + "\n- ".join(problems), True
        self.decision = call
        return "Sent. Stop here.", False

    def _propose_change(self, call: Propose) -> tuple[str, bool]:
        if self.dug:
            return "A question about the past changes nothing. Use submit_insight.", True
        self.decision = call
        return "Sent to the person to accept or decline. Stop here.", False

    def results_so_far(self) -> str:
        return json.dumps([_for_claude(r) for r in self._results], ensure_ascii=False)

    def best_so_far(self, timed_out: bool) -> Insight:
        """Claude stopped without an accepted answer: the last draft if it holds up, otherwise a plain sentence."""
        if self.decision is not None:
            return self.decision
        if self._draft is not None:
            try:
                insight, problems = self._build(SubmitInsight.model_validate({**self._draft, "chart": None}), True)
                if not problems:
                    return insight
            except ValidationError:
                pass
        if self._out_of_budget or timed_out:
            return Insight(STOPPED_EMPTY)
        return Insight(CANNOT_VOUCH if self._rejected else UNFINISHED)

    # ---- Speaking MCP ---------------------------------------------------------------------------

    def _call_tool(self, name: str, arguments: dict) -> tuple[str, bool]:
        if name not in _TOOLS:
            return f"There is no tool called {name}.", True
        if self.decision is not None:
            return "Your reply is already recorded. Stop here.", True
        model, _ = _TOOLS[name]
        try:
            call = model.model_validate(arguments)
        except ValidationError as e:
            return "Those arguments don't fit: " + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()), True
        return getattr(self, f"_{name}")(call)

    def _respond(self, method: str, params: dict) -> dict:
        if method == "initialize":
            return {"protocolVersion": params.get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}},
                    "serverInfo": {"name": SERVER_NAME, "version": "1"}}
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
