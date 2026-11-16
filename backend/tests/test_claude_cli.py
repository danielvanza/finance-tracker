"""Claude through the CLI's login, as the categoriser uses it. The sandbox itself is botkit's (its own checks)."""
import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from botkit.runners.base import RunnerFailure, RunResult

from categorizer import ai
from models import Category


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
    answer = RunResult('[{"index": 0, "category": "Groceries", "confidence": 0.9}]')
    tx = SimpleNamespace(amount=Decimal("-12.50"), description="ALBERT HEIJN")
    runner = SimpleNamespace(run=lambda request: answer)
    with patch("categorizer.claude_cli.runner", return_value=runner), \
            patch.object(runner, "run", wraps=runner.run) as run, \
            patch("categorizer.ai.anthropic.Anthropic") as api:
        results = ai.batch_categorise_with_ai([tx], db)
    assert results[0].category.name == "Groceries"
    api.assert_not_called()
    request = run.call_args.args[0]
    assert "ALBERT HEIJN" in request.prompt
    assert request.tools == []  # sorting runs with no tools at all


def test_a_failed_run_leaves_transactions_for_review(cli_env, db):
    db.add(Category(name="Groceries", type="needs"))
    db.commit()
    tx = SimpleNamespace(amount=Decimal("-1"), description="X")

    def logged_out(request):
        raise RunnerFailure("logged_out", "Claude Code is logged out on this machine")

    with patch("categorizer.claude_cli.runner", return_value=SimpleNamespace(run=logged_out)):
        assert ai.batch_categorise_with_ai([tx], db) == {}
