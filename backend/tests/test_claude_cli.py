"""Claude through the CLI's login: what the process gets to see, and how the categoriser uses it."""
import json
import os
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from categorizer import ai, claude_cli
from models import Category


def _value_after(command, flag):
    return command[command.index(flag) + 1]


def test_process_has_no_tools_and_an_empty_home(tmp_path):
    command, env = claude_cli.build_command(
        "sys", "haiku", "/opt/claude", tmp_path / "h", tmp_path / "w", tmp_path / "cred"
    )
    assert _value_after(command, "--tools") == ""
    assert _value_after(command, "--setting-sources") == ""
    assert "--strict-mcp-config" in command
    assert command[command.index("/home") - 1] == "--tmpfs"
    assert set(env) == {"LANG", "TERM", "NO_COLOR", "DISABLE_AUTOUPDATER", "HOME", "CLAUDE_CONFIG_DIR", "PATH"}


def test_account_details_are_removed_before_a_run(tmp_path):
    (tmp_path / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "a@b.c", "accountUuid": "u"}}))
    claude_cli._scrub_account(tmp_path)
    account = json.loads((tmp_path / ".claude.json").read_text())["oauthAccount"]
    assert "emailAddress" not in account
    assert account["accountUuid"] == "u"
    assert account["profileFetchedAt"] > 0


def test_a_refreshed_token_goes_back_to_the_real_file(tmp_path):
    credential = tmp_path / "real"
    credential.write_text("old")
    home = tmp_path / "home"
    home.mkdir()
    refreshed = home / ".credentials.json"
    refreshed.write_text("new")
    os.utime(credential, (1, 1))
    claude_cli._link_credential(home, credential)
    assert credential.read_text() == "new"
    assert refreshed.is_symlink()


@pytest.fixture
def cli_env(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_CLI_HOME", str(tmp_path / "cli"))
    credential = tmp_path / "cred"
    credential.write_text("{}")
    monkeypatch.setenv("CLAUDE_CREDENTIALS", str(credential))
    monkeypatch.setenv("CLAUDE_BIN", "/bin/true")


def test_categoriser_uses_the_login_when_set_up(cli_env, db):
    db.add(Category(name="Groceries", type="needs"))
    db.commit()
    answer = json.dumps({"is_error": False, "result": '[{"index": 0, "category": "Groceries", "confidence": 0.9}]'})
    tx = SimpleNamespace(amount=Decimal("-12.50"), description="ALBERT HEIJN")
    with patch("categorizer.claude_cli._run", return_value=SimpleNamespace(returncode=0, stdout=answer, stderr="")) as run, \
            patch("categorizer.ai.anthropic.Anthropic") as api:
        results = ai.batch_categorise_with_ai([tx], db)
    assert results[0][0].name == "Groceries"
    api.assert_not_called()
    assert "ALBERT HEIJN" in run.call_args.args[1]
    assert "ALBERT HEIJN" not in " ".join(run.call_args.args[0])


def test_a_failed_run_leaves_transactions_for_review(cli_env, db):
    db.add(Category(name="Groceries", type="needs"))
    db.commit()
    tx = SimpleNamespace(amount=Decimal("-1"), description="X")
    failed = SimpleNamespace(returncode=1, stdout="", stderr="logged out")
    with patch("categorizer.claude_cli._run", return_value=failed):
        assert ai.batch_categorise_with_ai([tx], db) == {}
