from unittest.mock import patch, MagicMock
from decimal import Decimal
from datetime import date
from categorizer.rules import apply_rules
from categorizer.ai import categorise_with_ai
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
    mock_response.content = [MagicMock(text='{"category": "Food - Essential", "confidence": 0.85}')]

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
