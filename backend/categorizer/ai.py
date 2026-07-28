import json
import re
import anthropic
from sqlalchemy.orm import Session
from models import Category

AI_MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 50  # Max transactions per AI call


def _strip_markdown_fences(text: str) -> str:
    """Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM output."""
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    stripped = re.sub(r"\n?```\s*$", "", stripped)
    return stripped.strip()


def _get_categories_for_sign(categories: list[Category], amount) -> list[Category]:
    """Filter categories by transaction sign compatibility."""
    if amount > 0:
        return [c for c in categories
                if (c.type.value if hasattr(c.type, "value") else str(c.type)) in ("income", "exclude")]
    else:
        return [c for c in categories
                if (c.type.value if hasattr(c.type, "value") else str(c.type)) in ("needs", "wants", "savings", "exclude")]


def categorise_with_ai(transaction, db: Session) -> tuple[Category, float] | None:
    """Categorise a single transaction with AI. Kept for backward compatibility."""
    results = batch_categorise_with_ai([transaction], db)
    return results.get(0)


def batch_categorise_with_ai(
    transactions: list, db: Session
) -> dict[int, tuple[Category, float]]:
    """Categorise multiple transactions in a single AI call (or batches of BATCH_SIZE).

    Transactions are grouped by sign (income vs expense) and each group gets
    only the relevant categories in the prompt.

    Returns a dict mapping transaction index -> (Category, confidence).
    Missing indices mean categorisation failed for that transaction.
    """
    if not transactions:
        return {}

    all_categories = db.query(Category).all()
    cat_by_name = {c.name: c for c in all_categories}

    try:
        client = anthropic.Anthropic()
    except TypeError as e:
        print(f"[AI categoriser] Configuration error: {e}")
        return {}

    results: dict[int, tuple[Category, float]] = {}

    # Group by sign: positive (income) and negative (expense)
    income_txs = [(i, tx) for i, tx in enumerate(transactions) if tx.amount > 0]
    expense_txs = [(i, tx) for i, tx in enumerate(transactions) if tx.amount <= 0]

    for group, group_label in [(income_txs, "income"), (expense_txs, "expense")]:
        if not group:
            continue

        # Get categories appropriate for this sign
        sample_amount = group[0][1].amount
        filtered_cats = _get_categories_for_sign(all_categories, sample_amount)
        if not filtered_cats:
            continue
        category_names = [c.name for c in filtered_cats]

        for batch_start in range(0, len(group), BATCH_SIZE):
            batch = group[batch_start: batch_start + BATCH_SIZE]
            tx_lines = []
            for _, (global_idx, tx) in enumerate(batch):
                sign_label = "income" if tx.amount > 0 else "expense"
                tx_lines.append(f'{global_idx}: "{tx.description}" ({sign_label}, €{abs(tx.amount):.2f})')

            prompt = (
                f"Categorise each {group_label} transaction below into one of the available categories.\n"
                f"Available categories: {', '.join(category_names)}\n\n"
                "Transactions:\n" + "\n".join(tx_lines) + "\n\n"
                "Respond with a JSON array only. Each element: "
                '{"index": <number>, "category": "<name>", "confidence": <0.0-1.0>}'
            )
            try:
                response = client.messages.create(
                    model=AI_MODEL,
                    max_tokens=4096,
                    system="You are a financial transaction categoriser. Respond with JSON only.",
                    messages=[{"role": "user", "content": prompt}],
                )
                raw_text = response.content[0].text
                cleaned = _strip_markdown_fences(raw_text)
                items = json.loads(cleaned)
                if not isinstance(items, list):
                    print("[AI categoriser] Expected JSON array, got:", type(items).__name__)
                    continue
                for item in items:
                    idx = int(item["index"])
                    cat = cat_by_name.get(item["category"])
                    if cat is None:
                        continue
                    confidence = float(item["confidence"])
                    if not (0.0 <= confidence <= 1.0):
                        continue
                    results[idx] = (cat, confidence)
            except anthropic.APIError as e:
                print(f"[AI categoriser] Anthropic API error: {e}")
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                print(f"[AI categoriser] Parse error: {e}")
            except TypeError as e:
                print(f"[AI categoriser] Configuration error: {e}")

    return results
