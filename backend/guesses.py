"""Payments Claude sorted by guessing: which count at once, which wait for an answer, and what an
answer teaches.

A guess Claude is sure of counts straight away (confirmed, still marked `ai`: "sorted automatically").
A doubtful one waits, unconfirmed, and counts nowhere. When a person says where a shop belongs, that
becomes a rule, so the shop's other waiting payments and every later one follow without a question.
"""
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import Session, selectinload

import money
from categorizer import claude_cli
from categorizer.ai import batch_categorise_with_ai
from categorizer.rules import fits, is_sign_compatible, matching_rule, squeeze  # noqa: F401 - squeeze is used through here
from models import Category, CategoryType, Rule, Setting, Transaction

logger = logging.getLogger(__name__)

PERSONAL_CATEGORY = "To personal accounts"
MIN_PATTERN = 3
MIN_ONE_WORD = 4  # a single word shorter than this would match too much as a rule
PATTERN_WORDS = 3  # of a shop, before its branch number
NAME_WORDS = 6  # of a name with no number in it
CODE_LENGTH, CODE_DIGITS = 10, 4
_PAYMENT_SERVICES = {
    "sumup", "paypal", "mollie", "pay.nl", "zettle", "izettle", "adyen", "stripe", "buckaroo", "tikkie", "klarna",
    "hipay", "afterpay", "riverty",
}
# Words around a payment service's name that say nothing about what was bought.
_SERVICE_FILLER = {
    "aab", "ing", "bank", "inz", "inzake", "europe", "s.a.r.l", "sarl", "et", "cie", "s.c.a", "sca", "stichting", "stg",
    "derdengelden", "payments", "payment", "bv", "b.v", "nv", "n.v", "ab", "via", "pay", "sas", "ltd", "limited", "inc",
    "gmbh", "the", "technology", "international", "services", "netherlands", "nederland", "ireland",
}
OWN_NAMES = "own_names"  # the setting: the household's own names as the bank shows them, separated by ";"
MAX_OPTIONS = 3
_SPENDING = (CategoryType.needs, CategoryType.wants, CategoryType.savings)


def _is_number(word: str) -> bool:
    """A branch or terminal number such as 1172 or 2.0."""
    return any(ch.isdigit() for ch in word) and not any(ch.isalpha() for ch in word)


def _is_code(word: str) -> bool:
    """A reference a payment service puts in front, such as NLOVX75PG4NENAVJ8Z: long, with many digits."""
    return len(word) >= CODE_LENGTH and sum(ch.isdigit() for ch in word) >= CODE_DIGITS


def shop_pattern(description: str) -> str:
    """The words of a description that name the shop or person, as text every payment of theirs contains.

    "ALBERT HEIJN 1172 ENSCHEDE NLD" gives "albert heijn": the name up to its branch number. A payment
    service's prefix ("BCK*") and a reference in front are left out. A number in front is part of the
    name: "1448 Enschede Enschede NLD" gives "1448 enschede enschede", never the town alone. A description
    without a number is a name in full, such as a person's, and is kept whole: "Mw A de Vries" must not
    shrink to "mw a de". A name too short to be safe as a rule ("XQZ 8841 Holding") is kept with what
    follows it.
    """
    whole = squeeze(description)
    text = whole
    head, star, rest = text.partition("*")
    if star:
        head, rest = head.strip(), rest.lstrip("* ")
        if rest and (len(head) <= 3 or head.strip(" _-.") in _PAYMENT_SERVICES):
            text = rest  # "ccv*cafe rocks enschede": the shop is after the star
        elif len(head) >= MIN_PATTERN:
            return head  # "paywave**8852* dublin irl": the name is before it
    words: list[str] = []
    numbered = False
    for word in text.split():
        if _is_number(word) or _is_code(word):
            numbered = True
            if any(not _is_number(w) for w in words):
                break
            if _is_code(word):
                continue
        words.append(word)
    pattern = " ".join(words[:PATTERN_WORDS if numbered else NAME_WORDS])
    safe = len(pattern) >= MIN_PATTERN and (" " in pattern or len(pattern) >= MIN_ONE_WORD) and any(ch.isalpha() for ch in pattern)
    return pattern if safe else whole


def hides_shop(pattern: str) -> bool:
    """Whether a pattern names only a payment service, such as "aab inz tikkie" or "paypal europe s.a.r.l.
    et cie s.c.a": what was bought is different every time, so one answer says nothing about the next."""
    words = [w.strip(".,*_-") for w in pattern.split()]
    service = [w for w in words if any(name in w for name in _PAYMENT_SERVICES)]
    telling = [w for w in words if w not in service and w not in _SERVICE_FILLER and len(w) >= 3]
    return bool(service) and not telling


def waiting(db: Session) -> list[Transaction]:
    """Every payment that waits for a person: not counted, not split, not a refund already."""
    rows = (
        db.query(Transaction).options(selectinload(Transaction.splits))
        .filter(Transaction.confirmed == False)  # noqa: E712
        .order_by(Transaction.date.desc(), Transaction.id.desc()).all()
    )
    return [t for t in rows if not t.splits]


# ---- What an answer teaches ---------------------------------------------------------------------

def remember(db: Session, tx: Transaction) -> Rule | None:
    """A person put this payment in its category: make that the rule for its shop."""
    if tx.category is None or tx.is_refund or tx.splits or not is_sign_compatible(tx.amount, tx.category):
        return None
    pattern = shop_pattern(tx.description)
    if len(pattern) < MIN_PATTERN or hides_shop(pattern):
        return None
    same = [
        r for r in db.query(Rule).all()
        if squeeze(r.pattern) == pattern and is_sign_compatible(tx.amount, r.category)
    ]
    if same:
        same[0].category_id = tx.category_id
        return same[0]
    rule = Rule(pattern=pattern, category_id=tx.category_id)
    db.add(rule)
    db.flush()
    return rule


def settle_like(db: Session, tx: Transaction) -> list[Transaction]:
    """The same shop's other waiting payments follow the answer just given for this one."""
    if tx.category is None or tx.is_refund or tx.splits:
        return []
    pattern = shop_pattern(tx.description)
    if hides_shop(pattern):
        return []
    settled = []
    for other in waiting(db):
        if other.id == tx.id or other.is_refund or (other.amount > 0) != (tx.amount > 0):
            continue
        if fits(pattern, squeeze(other.description)) and is_sign_compatible(other.amount, tx.category):
            other.category_id = tx.category_id
            other.confirmed = True
            other.categorised_by = "rule"
            settled.append(other)
    return settled


def learn(db: Session, tx: Transaction) -> list[Transaction]:
    """What a person's answer for one payment settles: the shop's rule and its other waiting payments."""
    remember(db, tx)
    settled = settle_like(db, tx)
    db.flush()
    return settled


# ---- Money moved to a personal account ----------------------------------------------------------

def own_names(db: Session) -> list[str]:
    """The names the household entered in Setup as its own, as the bank shows them."""
    setting = db.get(Setting, OWN_NAMES)
    names = [squeeze(name) for name in (setting.value if setting else "").split(";")]
    return [name for name in names if len(name) >= MIN_PATTERN]


def sort_personal(db: Session, rows: list[Transaction]) -> int:
    """Money going out to one of the household's own names goes to the personal-accounts category: a name
    entered in Setup, wherever it appears in the description."""
    personal = db.query(Category).filter_by(name=PERSONAL_CATEGORY).first()
    if personal is None or personal.type not in _SPENDING:
        return 0
    entered = own_names(db)
    moved = 0
    for tx in rows:
        text = squeeze(tx.description)
        own = any(name in text for name in entered)
        if tx.amount < 0 and tx.categorised_by != "rule" and not tx.splits and own:
            tx.category = personal
            tx.category_id = personal.id
            tx.confirmed = True
            tx.categorised_by = "rule"
            tx.ai_options = []
            moved += 1
    return moved


# ---- Sure or doubtful ---------------------------------------------------------------------------

def take_guess(tx: Transaction, guess) -> None:
    """Put Claude's sorting on a payment: counted if it was sure, waiting with its options if not."""
    tx.category = guess.category
    tx.category_id = guess.category.id
    tx.ai_confidence = guess.confidence
    tx.categorised_by = "ai"
    tx.confirmed = guess.sure
    tx.ai_options = [] if guess.sure else [c.id for c in guess.options]


def judge_backlog(db: Session, limit: int = 100) -> dict:
    """Payments nobody has judged sure-or-doubtful yet get judged like new ones, up to `limit` at a time
    so that what is done is saved as it goes: those that waited from before this was told apart, and
    those an import ran out of time for.

    Rules first, then Claude. A payment Claude could not be reached for stays as it was, for next time.
    """
    unjudged = [t for t in waiting(db) if t.ai_options is None and not t.is_refund]
    pending = unjudged[:limit]
    counts = {"by_rule": 0, "sure": 0, "doubtful": 0, "left": 0, "more": len(unjudged) - len(pending), "no_answer": []}
    if not pending:
        return counts
    for_claude = []
    for tx in pending:
        rule = matching_rule(tx.description, tx.amount, db)
        if rule is not None:
            tx.category_id, tx.confirmed, tx.categorised_by, tx.ai_options = rule.category_id, True, "rule", []
            counts["by_rule"] += 1
        else:
            for_claude.append(tx)
    db.commit()  # Claude takes its time; what the rules settled is saved first
    try:
        guessed = batch_categorise_with_ai(for_claude, db)
    except claude_cli.ClaudeCliError as e:
        logger.warning("[guesses] Claude could not judge the waiting payments: %s", e)
        guessed = {}
    still_open = []
    for i, tx in enumerate(for_claude):
        guess = guessed.get(i)
        if guess is None:
            counts["left"] += 1
            counts["no_answer"].append(tx.id)
            continue
        # A person may have answered for this payment while Claude was thinking: their word stands.
        db.refresh(tx)
        if tx.confirmed or tx.ai_options is not None or tx.splits:
            continue
        take_guess(tx, guess)
        still_open.append(tx)
        counts["sure" if guess.sure else "doubtful"] += 1
    counts["by_rule"] += sort_personal(db, still_open)
    db.commit()
    return counts


# ---- Questions ----------------------------------------------------------------------------------

@dataclass
class Group:
    """One shop's (or person's) waiting payments in one direction: what a single question is about."""
    pattern: str
    incoming: bool
    rows: list[Transaction] = field(default_factory=list)
    only: int | None = None  # the one payment it is about, when its name says nothing about the next one

    @property
    def key(self) -> str:
        return f"{'in' if self.incoming else 'out'}:{self.pattern}" + (f":{self.only}" if self.only is not None else "")

    @property
    def total_cents(self) -> int:
        return money.to_cents(sum((t.amount for t in self.rows), Decimal("0")))

    @property
    def name(self) -> str:
        """The shop as the bank writes it, taken from the newest payment."""
        text = " ".join(self.rows[0].description.split())
        at = text.lower().find(self.pattern)
        return text if at < 0 else text[at:at + len(self.pattern)]


def groups(db: Session, judged_only: bool = False, tried: frozenset[int] | set[int] = frozenset()) -> list[Group]:
    """Waiting payments by shop, the largest amounts first. A payment through a service that hides the
    shop is a group of its own. With judged_only, payments Claude has not looked at yet are left out,
    except those it was asked about and gave no answer for (`tried`)."""
    found: dict[str, Group] = {}
    for tx in waiting(db):
        if judged_only and tx.ai_options is None and not tx.is_refund and tx.id not in tried:
            continue
        pattern = shop_pattern(tx.description)
        group = Group(pattern, tx.amount > 0, only=tx.id if hides_shop(pattern) else None)
        found.setdefault(group.key, group).rows.append(tx)
    return sorted(found.values(), key=lambda g: (-abs(g.total_cents), g.key))


def option_out(category: Category, incoming: bool) -> dict:
    refund = incoming and category.type in _SPENDING
    return {"category_id": category.id, "label": f"Refund: {category.name}" if refund else category.name, "refund": refund}


def options_for(db: Session, group: Group) -> list[dict]:
    """The likely categories for a group, most likely first: Claude's guess, what else it considered,
    and for money coming back from a shop, what was bought there."""
    categories = {c.id: c for c in db.query(Category).all()}
    order: list[int] = []
    votes: dict[int, int] = {}
    for tx in group.rows:
        if tx.category_id is not None:
            votes[tx.category_id] = votes.get(tx.category_id, 0) + 1
    order += sorted(votes, key=lambda cid: -votes[cid])
    for tx in group.rows:
        order += [cid for cid in (tx.ai_options or []) if isinstance(cid, int)]
    if group.incoming:
        bought = db.query(Transaction).filter(
            Transaction.amount < 0, Transaction.confirmed == True, Transaction.category_id != None,  # noqa: E711,E712
        ).order_by(Transaction.date.desc()).all()
        order += [t.category_id for t in bought if fits(group.pattern, squeeze(t.description))]
    options = []
    for cid in dict.fromkeys(order):
        category = categories.get(cid)
        if category is None:
            continue
        if is_sign_compatible(group.rows[0].amount, category) or (group.incoming and category.type in _SPENDING):
            options.append(option_out(category, group.incoming))
        if len(options) == MAX_OPTIONS:
            break
    return options


def answer(db: Session, rows: list[Transaction], category: Category) -> list[Transaction]:
    """A person's answer for a group: its waiting payments get the category, and the shop is remembered.

    Money coming in that is put in a spending category is a refund of it. Returns every payment sorted,
    the shop's other waiting ones included.
    """
    sorted_rows = []
    for tx in rows:
        if tx.confirmed or tx.splits:
            continue
        refund = tx.amount > 0 and category.type in _SPENDING
        if not refund and not is_sign_compatible(tx.amount, category):
            continue
        tx.category = category
        tx.category_id = category.id
        tx.is_refund = refund
        tx.confirmed = True
        tx.categorised_by = "manual"
        sorted_rows.append(tx)
    db.flush()
    if sorted_rows and not sorted_rows[0].is_refund:
        sorted_rows += learn(db, sorted_rows[0])
    return sorted_rows
