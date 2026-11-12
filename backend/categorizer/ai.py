import json
import logging
from dataclasses import dataclass, field
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
CLI_MODEL = os.getenv("SORT_MODEL", "sonnet")  # the model that sorts imported rows, on the Claude login
CLI_TIMEOUT_SECONDS = 120
SYSTEM_PROMPT = "You are a financial transaction categoriser. Respond with JSON only."

logger = logging.getLogger(__name__)


def _strip_markdown_fences(text: str) -> str:
    """Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM output."""
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    stripped = re.sub(r"\n?```\s*$", "", stripped)
    return stripped.strip()


def _type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


@dataclass
class Guess:
    """Claude's sorting of one payment. `sure` means it counts without a person looking; when it is not
    sure, `options` are the categories it could be, most likely first (the guess itself included)."""
    category: Category
    sure: bool
    options: list[Category] = field(default_factory=list)

    @property
    def confidence(self) -> float:
        return 0.95 if self.sure else 0.5


_HOW_SURE = (
    'Also say whether you are sure. Be sure ("sure": true) whenever the name tells you what kind of shop, '
    "restaurant, service or bill it is, at home or abroad. Then pick the closest category, also when two would "
    "do: a supermarket or convenience store is groceries, a restaurant, café, bar or takeaway is eating out, "
    "public transport, fuel and parking are transport, and a drugstore, web shop or general store goes where "
    'everyday shopping goes. Be not sure ("sure": false) only when a person has to say what it was: a '
    "person's name; a transfer to or from another account, a bank or a savings account; a payment service that "
    "hides what was bought, such as Tikkie or PayPal; or a name that gives no hint of what it is. When you are "
    'not sure, give "options": up to three categories it could be, most likely first.'
)
_OUTGOING = (
    "Sort each payment below into one of the categories.\n"
    "Categories: {categories}\n\n" + _HOW_SURE + "\n\n"
    "Payments:\n{lines}\n\n"
    "Respond with a JSON array only. Each element: "
    '{{"index": <number>, "category": "<name>", "sure": true or false, "options": ["<name>", ...]}}'
)
_INCOMING = (
    "Each line below is money that came in. Sort each into one of the categories.\n"
    "Categories: {categories}\n\n" + _HOW_SURE + " Money coming in is only sure when it is plainly a salary "
    "or a benefit. If it looks like a shop paying back a purchase, it is a refund: you are not sure, and the "
    "options name the kind of purchase it most likely refunds, from: {refund_categories}.\n\n"
    "Payments:\n{lines}\n\n"
    "Respond with a JSON array only. Each element: "
    '{{"index": <number>, "category": "<name>", "sure": true or false, "options": ["<name>", ...]}}'
)


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


def batch_categorise_with_ai(transactions: list, db: Session, cli_only: bool = False) -> dict[int, Guess]:
    """Sort many payments in a few Claude calls (BATCH_SIZE each), money in and money out separately.

    With cli_only (chat imports) only the Claude login is used and a Claude failure is raised as
    ClaudeCliError instead of leaving the rows unsorted, so the import can be refused whole.

    Returns payment index -> Guess. A missing index means that payment could not be sorted.
    """
    if not transactions:
        return {}

    if cli_only and not claude_cli.enabled():
        raise claude_cli.ClaudeCliError("the Claude login is not set up (CLAUDE_CLI_HOME)")

    all_categories = db.query(Category).all()
    cat_by_name = {c.name: c for c in all_categories}
    spending = [c for c in all_categories if _type(c) in ("needs", "wants", "savings")]
    incoming_fits = [c for c in all_categories if _type(c) in ("income", "exclude")]
    outgoing_fits = [c for c in all_categories if _type(c) in ("needs", "wants", "savings", "exclude")]

    try:
        complete = _completer()
    except TypeError as e:
        logger.error(f"[AI categoriser] Configuration error: {e}")
        return {}

    results: dict[int, Guess] = {}
    deadline = time.monotonic() + AI_TIME_BUDGET_SECONDS

    incoming = [(i, tx) for i, tx in enumerate(transactions) if tx.amount > 0]
    outgoing = [(i, tx) for i, tx in enumerate(transactions) if tx.amount <= 0]

    for group, fits, template in ((incoming, incoming_fits, _INCOMING), (outgoing, outgoing_fits, _OUTGOING)):
        if not group or not fits:
            continue
        # An option for money coming in may also be a spending category: that reads as a refund of it.
        may_offer = {c.id for c in fits} | ({c.id for c in spending} if template is _INCOMING else set())
        for batch_start in range(0, len(group), BATCH_SIZE):
            if time.monotonic() >= deadline:
                break
            batch = group[batch_start: batch_start + BATCH_SIZE]
            prompt = template.format(
                categories=", ".join(c.name for c in fits),
                refund_categories=", ".join(c.name for c in spending),
                lines="\n".join(f'{i}: "{tx.description}" (€{abs(tx.amount):.2f})' for i, tx in batch),
            )
            try:
                items = json.loads(_strip_markdown_fences(complete(prompt)))
                if not isinstance(items, list):
                    logger.warning(f"[AI categoriser] Expected JSON array, got: {type(items).__name__}")
                    continue
                wanted = {i for i, _ in batch}
                for item in items:
                    idx = int(item["index"])
                    cat = cat_by_name.get(item["category"])
                    if cat is None or idx not in wanted or cat.id not in {c.id for c in fits}:
                        continue
                    options = [cat]
                    for name in item.get("options") or []:
                        option = cat_by_name.get(name)
                        if option is not None and option.id in may_offer and option not in options:
                            options.append(option)
                    results[idx] = Guess(cat, item.get("sure") is True, options[:3])
            except (anthropic.APIError, claude_cli.ClaudeCliError) as e:
                if cli_only:
                    raise
                logger.warning(f"[AI categoriser] Claude error: {e}")
            except (json.JSONDecodeError, KeyError, ValueError, TypeError, AttributeError) as e:
                logger.warning(f"[AI categoriser] Parse error: {type(e).__name__}")

    return results
