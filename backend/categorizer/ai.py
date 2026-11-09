import json
import logging
import os
import re
import time
import anthropic
from sqlalchemy.orm import Session
from models import Category
from categorizer import claude_cli

AI_MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 50  # Max transactions per AI call
AI_TIMEOUT_SECONDS = 30
AI_MAX_RETRIES = 2
AI_TIME_BUDGET_SECONDS = int(os.getenv("AI_TIME_BUDGET_SECONDS", "60"))
CLI_MODEL = "haiku"
CLI_TIMEOUT_SECONDS = 120
SYSTEM_PROMPT = "You are a financial transaction categoriser. Respond with JSON only."

logger = logging.getLogger(__name__)


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


def _completer():
    """A function (prompt -> text) for whichever Claude access is set up: the CLI's login or the API."""
    if claude_cli.enabled():
        return lambda prompt: claude_cli.complete(SYSTEM_PROMPT, prompt, CLI_MODEL, CLI_TIMEOUT_SECONDS)
    client = anthropic.Anthropic(timeout=AI_TIMEOUT_SECONDS, max_retries=AI_MAX_RETRIES)

    def complete(prompt: str) -> str:
        response = client.messages.create(
            model=AI_MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    return complete


def categorise_with_ai(transaction, db: Session) -> tuple[Category, float] | None:
    """Categorise a single transaction with AI. Kept for backward compatibility."""
    results = batch_categorise_with_ai([transaction], db)
    return results.get(0)


def batch_categorise_with_ai(
    transactions: list, db: Session, cli_only: bool = False
) -> dict[int, tuple[Category, float]]:
    """Categorise multiple transactions in a single AI call (or batches of BATCH_SIZE).

    With cli_only (chat imports) only the Claude login is used and a Claude failure is raised as
    ClaudeCliError instead of leaving the rows uncategorised, so the import can be refused whole.

    Transactions are grouped by sign (income vs expense) and each group gets
    only the relevant categories in the prompt.

    Returns a dict mapping transaction index -> (Category, confidence).
    Missing indices mean categorisation failed for that transaction.
    """
    if not transactions:
        return {}

    if cli_only and not claude_cli.enabled():
        raise claude_cli.ClaudeCliError("the Claude login is not set up (CLAUDE_CLI_HOME)")

    all_categories = db.query(Category).all()
    cat_by_name = {c.name: c for c in all_categories}

    try:
        complete = _completer()
    except TypeError as e:
        logger.error(f"[AI categoriser] Configuration error: {e}")
        return {}

    results: dict[int, tuple[Category, float]] = {}
    deadline = time.monotonic() + AI_TIME_BUDGET_SECONDS

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
            if time.monotonic() >= deadline:
                break
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
                cleaned = _strip_markdown_fences(complete(prompt))
                items = json.loads(cleaned)
                if not isinstance(items, list):
                    logger.warning(f"[AI categoriser] Expected JSON array, got: {type(items).__name__}")
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
            except (anthropic.APIError, claude_cli.ClaudeCliError) as e:
                if cli_only:
                    raise
                logger.warning(f"[AI categoriser] Claude error: {e}")
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                logger.warning(f"[AI categoriser] Parse error: {e}")
            except TypeError as e:
                logger.error(f"[AI categoriser] Configuration error: {e}")

    return results
