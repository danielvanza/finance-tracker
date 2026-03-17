import json
import anthropic
from sqlalchemy.orm import Session
from models import Category

def categorise_with_ai(transaction, db: Session) -> tuple[Category, float] | None:
    categories = db.query(Category).all()
    category_names = [c.name for c in categories]

    client = anthropic.Anthropic()
    prompt = (
        f"Transaction description: \"{transaction.description}\"\n"
        f"Available categories: {', '.join(category_names)}\n"
        "Respond with JSON only: {\"category\": \"<name>\", \"confidence\": <0.0-1.0>}"
    )
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=64,
            system="You are a financial transaction categoriser. Respond with JSON only.",
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(response.content[0].text)
        cat = next((c for c in categories if c.name == data["category"]), None)
        if cat is None:
            return None
        return cat, float(data["confidence"])
    except (json.JSONDecodeError, KeyError, Exception):
        return None
