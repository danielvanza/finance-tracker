"""Claude without an API key: `claude -p` on this machine's existing login, in a sandbox.

On when CLAUDE_CLI_HOME is set (a private folder for the sandbox's home). The model gets the prompt
and nothing else: no tools, settings or MCP, an allowlisted environment, and a bubblewrap container
where /home is empty, so the machine's files and normal Claude configuration are not there to read.
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
# The CLI adds the account's email to what it sends the model, read from the profile cached here.
_PERSONAL_ACCOUNT_FIELDS = ("emailAddress", "displayName", "fullName", "organizationName")

# One run at a time: runs share the sandbox home, its account cache and the credential link.
_lock = threading.Lock()


class ClaudeCliError(Exception):
    pass


def enabled() -> bool:
    return bool(os.getenv("CLAUDE_CLI_HOME"))


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
    system: str, model: str, binary: str, home: Path, work: Path, credential: Path
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


def complete(system: str, prompt: str, model: str, timeout: float) -> str:
    """Run one prompt and return the model's text. Raises ClaudeCliError if it can't."""
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

    command, env = build_command(system, model, binary, home, work, credential)
    command[0] = shutil.which("bwrap") or "bwrap"
    with _lock:
        _link_credential(home, credential)
        _scrub_account(home)
        try:
            run = subprocess.run(
                command, input=prompt, env=env, cwd=work, timeout=timeout,
                capture_output=True, text=True,
            )
        except subprocess.TimeoutExpired as e:
            raise ClaudeCliError(f"stopped after {timeout:.0f} seconds") from e
        except OSError as e:
            raise ClaudeCliError(f"could not start: {e}") from e
        finally:
            _link_credential(home, credential)
            _scrub_account(home)

    try:
        result = json.loads(run.stdout)
    except ValueError as e:
        raise ClaudeCliError(f"exit {run.returncode}: {run.stderr.strip()[:200]}") from e
    if run.returncode != 0 or result.get("is_error"):
        raise ClaudeCliError(f"exit {run.returncode}: {str(result.get('result'))[:200]}")
    return result["result"]
