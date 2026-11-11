"""Claude without an API key: `claude -p` on this machine's existing login, in a sandbox.

On when CLAUDE_CLI_HOME is set (a private folder for the sandbox's home). The model gets the prompt
and nothing else: no built-in tools, settings or outside MCP, an allowlisted environment, and a bubblewrap container
where /home is empty, so the machine's files and normal Claude configuration are not there to read.
A caller can hand over its own tools; they reach the model as one private MCP server (see assistant/tools.py).
"""
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

_SANDBOX_HOME = "/sandbox/home"
_SANDBOX_WORK = "/sandbox/work"
_SANDBOX_CRED_DIR = "/sandbox/cred"
_SANDBOX_BIN = "/sandbox/bin"
_CREDENTIAL_NAME = ".credentials.json"
_TOOLS_FILE = "tools.json"
# The CLI adds the account's email to what it sends the model, read from the profile cached here.
_PERSONAL_ACCOUNT_FIELDS = ("emailAddress", "displayName", "fullName", "organizationName")

# One run at a time: runs share the sandbox home, its account cache and the credential link.
_lock = threading.Lock()


class ClaudeCliError(Exception):
    pass


class TimedOut(ClaudeCliError):
    """The run hit its time limit and was ended."""


class Stopped(ClaudeCliError):
    """The run was ended on request, before it finished."""


def enabled() -> bool:
    return bool(os.getenv("CLAUDE_CLI_HOME"))


def busy() -> bool:
    return _lock.locked()


def _credential_file() -> Path:
    return Path(os.getenv("CLAUDE_CREDENTIALS", str(Path.home() / ".claude" / _CREDENTIAL_NAME)))


def _link_credential(home: Path, credential: Path) -> None:
    """Point the sandbox home at the login token, by symlink so no second copy exists.

    A token refresh by atomic rename replaces the link with a real file holding the newest token,
    and the original may then be stale, so that file is moved back to the real location.
    """
    link = home / _CREDENTIAL_NAME
    target = f"{_SANDBOX_CRED_DIR}/{_CREDENTIAL_NAME}"
    if os.path.lexists(link) and not link.is_symlink():
        if credential.exists() and credential.stat().st_mtime < link.stat().st_mtime:
            os.replace(link, credential)
        else:
            link.unlink()
    if link.is_symlink() and os.readlink(link) != target:
        link.unlink()
    if not link.is_symlink():
        link.symlink_to(target)


def _scrub_account(home: Path) -> None:
    """Remove everything personal from the CLI's cached profile; the login doesn't depend on it.

    A fresh `profileFetchedAt` stops the CLI fetching the profile, and with it the email, again.
    """
    file = home / ".claude.json"
    try:
        config = json.loads(file.read_text())
    except (OSError, ValueError):
        config = {}
    account = config.get("oauthAccount") or {}
    for field in _PERSONAL_ACCOUNT_FIELDS:
        account.pop(field, None)
    config["oauthAccount"] = {
        "billingType": None,
        "accountCreatedAt": None,
        "subscriptionCreatedAt": None,
        "ccOnboardingFlags": {},
        **account,
        "profileFetchedAt": int(time.time() * 1000),
    }
    temp = home / ".claude.json.tmp"
    temp.touch(mode=0o600)
    temp.write_text(json.dumps(config))
    os.replace(temp, file)


def build_command(
    system: str, model: str, binary: str, home: Path, work: Path, credential: Path, allowed_tools: list[str] | None = None,
) -> tuple[list[str], dict[str, str]]:
    """The exact process to start and its complete environment."""
    command = [
        "bwrap",
        "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup-try",
        "--hostname", "sandbox", "--die-with-parent", "--new-session",
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind-try", "/lib64", "/lib64",
        "--ro-bind-try", "/etc/ssl", "/etc/ssl",
        "--ro-bind-try", "/etc/ca-certificates", "/etc/ca-certificates",
        "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
        "--ro-bind-try", "/etc/hosts", "/etc/hosts",
        "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--tmpfs", "/home",
        "--tmpfs", "/root",
        "--dir", "/sandbox",
        "--bind", str(home), _SANDBOX_HOME,
        "--bind", str(work), _SANDBOX_WORK,
        "--dir", _SANDBOX_CRED_DIR,
        "--bind", str(credential), f"{_SANDBOX_CRED_DIR}/{_CREDENTIAL_NAME}",
        "--ro-bind", binary, f"{_SANDBOX_BIN}/claude",
        "--chdir", _SANDBOX_WORK,
        "--",
        f"{_SANDBOX_BIN}/claude",
        "-p", "--model", model, "--output-format", "json",
        "--tools", "", "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "",
        "--no-session-persistence", "--system-prompt", system,
    ]
    if allowed_tools:
        command += ["--mcp-config", f"{_SANDBOX_WORK}/{_TOOLS_FILE}", "--allowedTools", ",".join(allowed_tools)]
    env = {
        "LANG": "C.UTF-8",
        "TERM": "dumb",
        "NO_COLOR": "1",
        "DISABLE_AUTOUPDATER": "1",
        "HOME": _SANDBOX_HOME,
        "CLAUDE_CONFIG_DIR": _SANDBOX_HOME,
        "PATH": f"{_SANDBOX_BIN}:/usr/bin:/bin",
    }
    return command, env


def _run(command: list[str], prompt: str, env: dict, cwd: Path, timeout: float, should_stop) -> subprocess.CompletedProcess:
    """The process to its end, unless the time runs out or should_stop() says to end it first."""
    try:
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=cwd, text=True,
        )
    except OSError as e:
        raise ClaudeCliError(f"could not start: {e}") from e
    output: dict = {}
    reader = threading.Thread(target=lambda: output.update(zip(("stdout", "stderr"), process.communicate(prompt))), daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    while reader.is_alive():
        reader.join(0.25)
        if not reader.is_alive():
            break
        stop = should_stop is not None and should_stop()
        if stop or time.monotonic() > deadline:
            process.kill()  # bwrap's --die-with-parent takes the CLI down with it
            reader.join(10)
            if stop:
                raise Stopped("stopped on request")
            raise TimedOut(f"stopped after {timeout:.0f} seconds")
    return subprocess.CompletedProcess(command, process.returncode, output.get("stdout", ""), output.get("stderr", ""))


def complete(
    system: str, prompt: str, model: str, timeout: float, on_wait=None,
    tools: dict | None = None, allowed_tools: list[str] | None = None, should_stop=None,
) -> str:
    """Run one prompt and return the model's text. Raises ClaudeCliError if it can't.

    Only one run happens at a time. If another is going, on_wait(True) is called before queueing
    behind it and on_wait(False) when this run starts. should_stop() is asked a few times a second;
    when it says yes, the run is ended and Stopped raised, also while still queued.
    """
    found = shutil.which(os.getenv("CLAUDE_BIN", "claude"))
    if not found:
        raise ClaudeCliError("the claude CLI was not found")
    binary = os.path.realpath(found)
    credential = _credential_file()
    if not credential.exists():
        raise ClaudeCliError("not logged in: run `claude auth login`")

    base = Path(os.environ["CLAUDE_CLI_HOME"])
    home = base / "home"
    work = base / "work"
    for folder in (base, home, work):
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)

    command, env = build_command(system, model, binary, home, work, credential, allowed_tools)
    command[0] = shutil.which("bwrap") or "bwrap"
    if not _lock.acquire(blocking=False):
        if on_wait:
            on_wait(True)
        while not _lock.acquire(timeout=0.25):
            if should_stop is not None and should_stop():
                raise Stopped("stopped while waiting")
        if on_wait:
            on_wait(False)
    try:
        _link_credential(home, credential)
        _scrub_account(home)
        tools_file = work / _TOOLS_FILE
        if tools:
            tools_file.touch(mode=0o600)
            tools_file.write_text(json.dumps(tools))
        try:
            run = _run(command, prompt, env, work, timeout, should_stop)
        finally:
            tools_file.unlink(missing_ok=True)
            _link_credential(home, credential)
            _scrub_account(home)
    finally:
        _lock.release()

    try:
        result = json.loads(run.stdout)
    except ValueError as e:
        raise ClaudeCliError(f"exit {run.returncode}: {run.stderr.strip()[:200]}") from e
    if run.returncode != 0 or result.get("is_error"):
        raise ClaudeCliError(f"exit {run.returncode}: {str(result.get('result'))[:200]}")
    return result["result"]
