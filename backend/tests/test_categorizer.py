from unittest.mock import patch, MagicMock
from decimal import Decimal
from datetime import date
from pathlib import Path
import time as time_module
from categorizer.rules import apply_rules
from categorizer.ai import categorise_with_ai, _strip_markdown_fences, batch_categorise_with_ai
import categorizer.ai
from models import Rule, Category
from importers.base import ParsedTransaction

def make_tx(description):
    return ParsedTransaction(
        date=date(2026, 3, 1),
        amount=Decimal("-10.00"),
        description=description,
        source="ing",
        import_hash=f"hash-{description}",
    )

def test_rule_matches_by_substring(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.flush()
    db.add(Rule(pattern="albert heijn", category_id=cat.id, priority=10))
    db.commit()

    result = apply_rules(make_tx("Albert Heijn #123"), db)
    assert result is not None
    assert result.id == cat.id

def test_rule_match_is_case_insensitive(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.flush()
    db.add(Rule(pattern="ZIGGO", category_id=cat.id, priority=5))
    db.commit()
    result = apply_rules(make_tx("ziggo internet"), db)
    assert result is not None

def test_rule_returns_none_when_no_match(db):
    result = apply_rules(make_tx("Unknown Merchant XYZ"), db)
    assert result is None

def test_rule_higher_priority_wins(db):
    cat1 = Category(name="Food", type="needs", sort_order=1)
    cat2 = Category(name="Misc", type="wants", sort_order=2)
    db.add_all([cat1, cat2])
    db.flush()
    db.add(Rule(pattern="test", category_id=cat1.id, priority=5))
    db.add(Rule(pattern="test", category_id=cat2.id, priority=10))
    db.commit()
    result = apply_rules(make_tx("test merchant"), db)
    assert result.id == cat2.id

def test_ai_categoriser_returns_category_and_confidence(db):
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.85}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = categorise_with_ai(make_tx("Albert Heijn"), db)

    assert result is not None
    category, confidence = result
    assert category.name == "Food - Essential"
    assert confidence == 0.85

def test_ai_categoriser_returns_none_on_invalid_json(db):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="I don't know")]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = categorise_with_ai(make_tx("Unknown"), db)

    assert result is None


def test_strip_markdown_fences_json_block():
    raw = '```json\n{"category": "Food", "confidence": 0.9}\n```'
    assert _strip_markdown_fences(raw) == '{"category": "Food", "confidence": 0.9}'

def test_strip_markdown_fences_plain_block():
    raw = '```\n{"category": "Food", "confidence": 0.9}\n```'
    assert _strip_markdown_fences(raw) == '{"category": "Food", "confidence": 0.9}'

def test_strip_markdown_fences_no_fences():
    raw = '{"category": "Food", "confidence": 0.9}'
    assert _strip_markdown_fences(raw) == '{"category": "Food", "confidence": 0.9}'

def test_ai_categoriser_handles_markdown_fenced_json(db):
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='```json\n[{"index": 0, "category": "Food - Essential", "confidence": 0.95}]\n```')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = categorise_with_ai(make_tx("Albert Heijn"), db)

    assert result is not None
    category, confidence = result
    assert category.name == "Food - Essential"
    assert confidence == 0.95


def test_rule_skips_income_category_for_expense(db):
    """An expense transaction should NOT match a rule pointing to an income category."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add(income_cat)
    db.flush()
    db.add(Rule(pattern="salaris", category_id=income_cat.id, priority=10))
    db.commit()

    result = apply_rules(make_tx("Salaris Maart"), db)
    assert result is None  # -10.00 should not match income category


def test_rule_matches_income_category_for_positive_amount(db):
    """A positive transaction should match a rule pointing to an income category."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add(income_cat)
    db.flush()
    db.add(Rule(pattern="salaris", category_id=income_cat.id, priority=10))
    db.commit()

    tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("3400.00"),
        description="Salaris Maart", source="ing", import_hash="hash-pos-1",
    )
    result = apply_rules(tx, db)
    assert result is not None
    assert result.name == "Salary"


def test_rule_skips_expense_category_for_income(db):
    """A positive transaction should NOT match a rule pointing to an expense category."""
    expense_cat = Category(name="Food", type="needs", sort_order=1)
    db.add(expense_cat)
    db.flush()
    db.add(Rule(pattern="refund", category_id=expense_cat.id, priority=10))
    db.commit()

    tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("50.00"),
        description="Refund Albert Heijn", source="ing", import_hash="hash-pos-2",
    )
    result = apply_rules(tx, db)
    assert result is None


def test_rule_falls_through_to_next_on_sign_mismatch(db):
    """If first matching rule has wrong sign, fall through to next lower-priority rule."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    expense_cat = Category(name="Misc", type="wants", sort_order=9)
    db.add_all([income_cat, expense_cat])
    db.flush()
    # Higher priority: income category (wrong for expense)
    db.add(Rule(pattern="payment", category_id=income_cat.id, priority=10))
    # Lower priority: expense category (correct for expense)
    db.add(Rule(pattern="payment", category_id=expense_cat.id, priority=5))
    db.commit()

    tx = make_tx("Monthly payment")  # negative amount
    result = apply_rules(tx, db)
    assert result is not None
    assert result.name == "Misc"


def test_ai_categoriser_filters_categories_by_sign_expense(db):
    """AI prompt for expense transactions should only include expense categories."""
    expense_cat = Category(name="Food - Essential", type="needs", sort_order=1)
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add_all([expense_cat, income_cat])
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.9}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        result = batch_categorise_with_ai([make_tx("Albert Heijn")], db)

    # Verify the prompt only contained expense categories
    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    assert "Food - Essential" in prompt
    assert "Salary" not in prompt


def test_ai_categoriser_filters_categories_by_sign_income(db):
    """AI prompt for income transactions should only include income categories."""
    expense_cat = Category(name="Food - Essential", type="needs", sort_order=1)
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add_all([expense_cat, income_cat])
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Salary", "confidence": 0.95}]')]

    income_tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("3400.00"),
        description="Salaris Maart", source="ing", import_hash="hash-ai-income",
    )

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        result = batch_categorise_with_ai([income_tx], db)

    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    assert "Salary" in prompt
    assert "Food - Essential" not in prompt

    assert 0 in result
    assert result[0][0].name == "Salary"


def test_ai_categoriser_includes_sign_in_prompt(db):
    """AI prompt should include the sign/amount context for each transaction."""
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.9}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        batch_categorise_with_ai([make_tx("Albert Heijn")], db)

    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    # Verify the prompt includes sign context (e.g. "expense, €10.00")
    assert "expense" in prompt.lower()
    assert "€" in prompt


def test_ai_client_configured_with_timeout_and_retries(db):
    """The Anthropic client must be constructed with the module timeout/retry constants."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.9}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        batch_categorise_with_ai([make_tx("Albert Heijn")], db)

    _, constructor_kwargs = MockClient.call_args
    assert constructor_kwargs["timeout"] == categorizer.ai.AI_TIMEOUT_SECONDS
    assert constructor_kwargs["max_retries"] == categorizer.ai.AI_MAX_RETRIES


def test_time_budget_stops_new_batches(db):
    """Once the wall-clock budget expires, no NEW AI calls may be issued."""
    cat = Category(name="Other", type="wants", sort_order=1)
    db.add(cat)
    db.flush()
    txs = [make_tx(f"Unknown Merchant {i}") for i in range(120)]  # 3 expense batches: 50/50/20

    def slow_create(*args, **kwargs):
        time_module.sleep(0.08)  # one call must exceed the whole budget
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="[]")]
        return mock_response

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient, \
         patch.object(categorizer.ai, "AI_TIME_BUDGET_SECONDS", 0.05):
        MockClient.return_value.messages.create.side_effect = slow_create
        result = batch_categorise_with_ai(txs, db)

    assert MockClient.return_value.messages.create.call_count == 1
    # Only first-batch indices (0..49) can appear; later batches (50+) must be absent
    for idx in result:
        assert idx < 50


def test_no_print_statements_in_ai_module():
    source = (Path(__file__).resolve().parents[1] / "categorizer" / "ai.py").read_text()
    assert "print(" not in source
