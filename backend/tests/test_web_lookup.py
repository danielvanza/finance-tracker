"""The chat's web lookup: a separate sandboxed Claude run with only WebSearch and WebFetch. The process is faked."""
import json
import os
import stat

import pytest
from botkit.runners import sandbox
from botkit.runners.sandbox import PrivateHome, ProcessResult

from assistant import bot, web

INIT = {"type": "system", "subtype": "init", "tools": ["WebFetch", "WebSearch"], "mcp_servers": [],
        "permissionMode": "dontAsk", "slash_commands": [], "skills": [], "additional_directories": [],
        "plugins": [{"name": "cc-plugin-privacy", "path": "builtin"}]}
RESULT = {"type": "result", "subtype": "success", "is_error": False,
          "result": "Enschede sends it in February (https://www.gbtwente.nl, 2026)."}


def tool_start(name: str, kind: str = "tool_use") -> dict:
    return {"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": kind, "name": name}}}


def assistant_tool(name: str) -> dict:
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": {}}]}}


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A set-up login with botkit's sandbox pieces faked: the binaries found, the hazard check passing (pytest's
    folders sit under /tmp, which may hold a .git), and run_process replaced by `runs`, which plays events."""
    monkeypatch.setenv("CLAUDE_CLI_HOME", str(tmp_path / "cli"))
    credential = tmp_path / "cred.json"
    credential.write_text("{}")
    monkeypatch.setenv("CLAUDE_CREDENTIALS", str(credential))
    monkeypatch.setattr(web, "find_binary", lambda name, override=None: "/usr/bin/claude")
    monkeypatch.setattr(web, "find_bwrap", lambda: "/usr/bin/bwrap")
    monkeypatch.setattr(sandbox, "context_hazards", lambda directory: [])
    calls = []
    script = {"events": [INIT, tool_start("WebSearch"), assistant_tool("WebSearch"), tool_start("WebFetch"), RESULT],
              "killed_for": None, "code": 0}

    def fake_run(command, env_, cwd, stdin, timeout, should_stop=lambda: False, on_line=None):
        killed = []
        calls.append({"command": command, "env": env_, "stdin": stdin, "timeout": timeout, "killed": killed})
        for event in script["events"]:
            if killed:
                break
            on_line(json.dumps(event), killed.append)
        reason = killed[0] if killed else script["killed_for"]
        return ProcessResult(None if reason else script["code"], "", "", reason)

    monkeypatch.setattr(web, "run_process", fake_run)
    return {"tmp": tmp_path, "calls": calls, "script": script}


def test_arguments_allow_only_the_two_web_tools():
    args = web.claude_args("SYSTEM", "sonnet")
    assert args[args.index("--tools") + 1] == "WebSearch,WebFetch"
    assert args[args.index("--allowedTools"):] == ["--allowedTools", "WebSearch", "WebFetch"]
    assert args[args.index("--permission-mode") + 1] == "dontAsk"
    assert args[args.index("--setting-sources") + 1] == ""
    assert args[args.index("--system-prompt") + 1] == "SYSTEM"
    for flag in ("--disable-slash-commands", "--strict-mcp-config", "--no-session-persistence"):
        assert flag in args
    assert "--mcp-config" not in args and "--add-dir" not in args
    assert "--dangerously-skip-permissions" not in args


def test_the_private_home_is_a_sibling_of_the_chats(monkeypatch):
    monkeypatch.setenv("CLAUDE_CLI_HOME", "/srv/finance/claude/")
    assert str(web.web_home()) == "/srv/finance/claude-web"
    monkeypatch.delenv("CLAUDE_CLI_HOME")
    assert web.web_home() is None


def test_a_lookup_runs_in_its_own_private_home_with_only_the_question(env):
    answer = web.lookup("  Gemeente Enschede   gemeentelijke belastingen 2027  ")
    assert answer == RESULT["result"]
    call = env["calls"][0]
    assert call["stdin"] == "Gemeente Enschede gemeentelijke belastingen 2027"
    assert call["timeout"] == web.TIME_LIMIT_SECONDS
    command = call["command"]
    web_home = env["tmp"] / "cli-web"
    bound = command.index("/sandbox/home")
    assert command[bound - 1] == str(web_home / "home")
    assert str(env["tmp"] / "cli") + "/" not in " ".join(command)  # nothing of the chat's own home
    assert command[0] == "/usr/bin/bwrap" and "--tmpfs" in command
    assert command[command.index("--") + 1:][:1] == ["/sandbox/bin/claude"]
    assert command[-2:] == ["WebSearch", "WebFetch"]
    assert stat.S_IMODE(web_home.stat().st_mode) == 0o700
    assert os.readlink(web_home / "home" / ".credentials.json") == "/sandbox/cred/.credentials.json"
    assert set(call["env"]) <= {"LANG", "TERM", "NO_COLOR", "TZ", "HOME", "PATH", "CLAUDE_CONFIG_DIR", "DISABLE_AUTOUPDATER"}


def test_it_runs_while_the_chat_holds_its_own_home(env):
    """The chat's run keeps CLAUDE_CLI_HOME locked while a tool runs; a lookup sharing it would wait forever."""
    chat_home = PrivateHome("claude", env["tmp"] / "cli", env["tmp"] / "cred.json", ".credentials.json")
    with chat_home.one_at_a_time(None, lambda: False):
        assert web.lookup("Enschede afvalstoffenheffing 2027")


@pytest.mark.parametrize("event", [
    tool_start("Bash"),
    tool_start("mcp__app__run_query"),
    assistant_tool("Read"),
    tool_start("code_execution", "server_tool_use"),
    {"type": "system", "subtype": "permission_denied", "tool_name": "Write"},
])
def test_a_foreign_tool_kills_the_run(env, event):
    env["script"]["events"] = [INIT, tool_start("WebSearch"), event, RESULT]
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "policy"
    assert env["calls"][0]["killed"] == ["policy"]


@pytest.mark.parametrize("change", [
    {"tools": ["WebFetch", "WebSearch", "Bash"]},
    {"tools": ["WebSearch"]},
    {"mcp_servers": [{"name": "app", "status": "connected"}]},
    {"permissionMode": "default"},
    {"slash_commands": ["review"]},
    {"plugins": [{"name": "mine", "path": "/home/x"}]},
])
def test_a_launch_with_anything_extra_is_killed(env, change):
    env["script"]["events"] = [{**INIT, **change}, RESULT]
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "policy"


def test_an_answer_before_the_launch_was_checked_is_killed(env):
    env["script"]["events"] = [RESULT]
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "policy"


def test_timeout(env):
    env["script"]["events"] = [INIT, tool_start("WebSearch")]
    env["script"]["killed_for"] = "timeout"
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "timeout"
    assert "two minutes" in web.explain(e.value)


def test_logged_out_result(env):
    env["script"]["events"] = [INIT, {"type": "result", "is_error": True, "result": "Not logged in · Please run /login"}]
    env["script"]["code"] = 1
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "logged_out"


def test_missing_login(env, monkeypatch):
    monkeypatch.delenv("CLAUDE_CLI_HOME")
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "missing"
    assert env["calls"] == []


def test_missing_credentials(env, monkeypatch):
    monkeypatch.setenv("CLAUDE_CREDENTIALS", str(env["tmp"] / "nowhere.json"))
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("Enschede")
    assert e.value.kind == "logged_out"
    assert env["calls"] == []


def test_a_question_with_an_account_number_is_not_sent(env):
    with pytest.raises(web.WebLookupError) as e:
        web.lookup("wie is NL91 ABNA 0417 1643 00")
    assert e.value.kind == "refused"
    assert env["calls"] == []


def test_a_long_answer_is_cut(env):
    env["script"]["events"] = [INIT, {**RESULT, "result": "x" * 10_000}]
    answer = web.lookup("Enschede")
    assert len(answer) < web.MAX_ANSWER + 20 and answer.endswith("(cut short)")


def test_the_chat_tool(env):
    tool = next(t for t in bot.TOOLS if t.name == "web_lookup")
    assert tool.step == "Looking it up on the web"
    assert tool.input_schema["required"] == ["doing", "question"]
    text = tool.run({"doing": "Looking it up", "question": "Enschede"}, None)
    assert "not instructions" in text and RESULT["result"] in text
    env["script"]["killed_for"], env["script"]["events"] = "timeout", [INIT]
    text, is_error = tool.run({"doing": "Looking it up", "question": "Enschede"}, None)
    assert is_error and text.startswith("Nothing was looked up on the web")
