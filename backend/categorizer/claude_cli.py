"""Claude without an API key: `claude -p` on this machine's existing login, in botkit's sandbox.

On when CLAUDE_CLI_HOME is set (a private folder for the sandbox's home). The sandbox itself (bubblewrap, an empty
/home, an allowlisted environment, no built-in tools, settings or outside MCP) is botkit's `ClaudeCliRunner`, the
same one the chat runs on, so there is one sandbox in the app. Sorting runs it with no tools at all. The chat and
sorting share the private home, and botkit lets one run use it at a time.
"""
import os
import threading
from pathlib import Path

from botkit import RunnerConfig
from botkit.runners.base import RunnerFailure, RunRequest, ToolResult
from botkit.runners.common import picture_type  # noqa: F401  (the chat's photo handler checks pictures with it)

CHAT_MODEL = os.getenv("CHAT_MODEL", "sonnet")
CLAUDE_MODELS = ("sonnet", "opus", "haiku")


class ClaudeCliError(Exception):
    """Claude could not answer. `kind` is botkit's failure kind (logged_out, rate_limited, missing, timeout …)."""

    def __init__(self, message: str, kind: str = "error"):
        super().__init__(message)
        self.kind = kind


def enabled() -> bool:
    return bool(os.getenv("CLAUDE_CLI_HOME"))


def _path(name: str) -> Path | None:
    value = os.getenv(name)
    return Path(value) if value else None


def runner_config() -> RunnerConfig:
    """Where every runner finds what it needs, from finance's environment. The chat and sorting share it."""
    models = [CHAT_MODEL, *(m for m in CLAUDE_MODELS if m != CHAT_MODEL)]
    config = RunnerConfig(
        claude_bin=os.getenv("CLAUDE_BIN") or None,
        claude_home=_path("CLAUDE_CLI_HOME"),
        claude_models=models,
        codex_home=_path("CODEX_CLI_HOME"),
        default_runner="claude-cli",
        default_model=CHAT_MODEL,
        # The E2E suite's scripted stand-in for a model (botkit SPEC §12). Never set in production.
        script_runner=os.getenv("FINANCE_SCRIPT_RUNNER") == "1",
    )
    if os.getenv("CLAUDE_CREDENTIALS"):
        config.claude_credentials = Path(os.environ["CLAUDE_CREDENTIALS"])
    return config


_runner = None
_runner_guard = threading.Lock()


def runner():
    """The sandboxed Claude login, built on first use."""
    global _runner
    with _runner_guard:
        if _runner is None:
            from botkit.runners.claude_cli import ClaudeCliRunner

            _runner = ClaudeCliRunner(runner_config())
        return _runner


def _no_tools(name: str, _args: dict) -> ToolResult:
    return ToolResult(f"There is no tool called {name}.", True)


def complete(system: str, prompt: str, model: str, timeout: float) -> str:
    """Run one prompt, with no tools, and return the model's text. Raises ClaudeCliError if it can't."""
    if not enabled():
        raise ClaudeCliError("the Claude login is not set up (CLAUDE_CLI_HOME)", "missing")
    try:
        return runner().run(RunRequest(system, prompt, model, [], _no_tools, timeout)).text
    except RunnerFailure as e:
        raise ClaudeCliError(getattr(e, "detail", "") or e.message, e.kind) from e


def explain(error: ClaudeCliError) -> str:
    """Why Claude could not answer, in the words the chat has always used."""
    return {
        "logged_out": "Claude is logged out on this machine, so it cannot answer until someone logs in again.",
        "rate_limited": "Claude has reached its usage limit, so it cannot answer until the limit resets.",
        "missing": "Claude is not set up on this machine.",
        "timeout": "Claude took too long to answer.",
    }.get(getattr(error, "kind", "error"), "Claude could not be reached.")
