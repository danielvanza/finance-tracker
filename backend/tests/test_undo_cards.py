"""Undoing an applied chat card, and removing an imported bank row so a later import does not bring it back."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import clock
import db as database
import import_service
from assistant import actions, bot
from db import Base
from importers.base import ParsedTransaction
from models import AppliedChange, Category, RemovedBankRow, SetAside, Transaction, TransactionSplit


@pytest.fixture
def session(tmp_path, monkeypatch):
    """A finance database on file, which actions' own transactions run against."""
    engine = create_engine(f"sqlite:///{tmp_path / 'finance.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(database, "engine", engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Category(id=1, name="Groceries", type="needs"), Category(id=2, name="Eating out", type="wants")])
    s.add(Transaction(id=10, date=date(2026, 11, 12), amount=Decimal("-4.50"), description="Albert Heijn",
                      source="ing", import_hash="ah-12", category_id=1, confirmed=True, categorised_by="rule"))
    s.commit()
    yield s
    s.close()
    engine.dispose()


def apply(name: str, args: dict, card_id: int) -> dict:
    shown = actions.preview(name, args)
    return actions.apply(name, args, shown, lambda conn, fresh: None, None, card_id=card_id)


def lines(name: str, args: dict) -> list[str]:
    return actions.plain(actions.preview(name, args))["lines"]


def test_an_applied_card_keeps_what_it_changed_and_undo_puts_it_back(session):
    apply("transaction.update", {"id": 10, "category_id": 2}, card_id=1)
    record = session.query(AppliedChange).filter_by(card_id=1).one()
    assert record.op == "transaction.update" and record.undone_at is None
    assert [(r["table"], r["key"]) for r in record.rows] == [("transactions", 10)]
    assert record.rows[0]["before"]["category_id"] == 1 and record.rows[0]["after"]["category_id"] == 2

    assert lines("card.undo", {"card_id": 1}) == ["Albert Heijn · 12 Nov · -⁠€4,50: Eating out → Groceries"]
    apply("card.undo", {"card_id": 1}, card_id=2)
    session.expire_all()
    assert session.get(Transaction, 10).category_id == 1
    assert session.query(AppliedChange).filter_by(card_id=1).one().undone_at is not None
    assert session.query(AppliedChange).filter_by(card_id=2).one().op == "card.undo"

    with pytest.raises(actions.ActionError, match="Card 1 was already undone"):
        actions.preview("card.undo", {"card_id": 1})


def test_undoing_an_undo_makes_the_change_again(session):
    apply("transaction.update", {"id": 10, "category_id": 2}, card_id=1)
    apply("card.undo", {"card_id": 1}, card_id=2)
    apply("card.undo", {"card_id": 2}, card_id=3)
    session.expire_all()
    assert session.get(Transaction, 10).category_id == 2


def test_undo_is_refused_when_a_row_changed_since(session):
    apply("transaction.update", {"id": 10, "category_id": 2}, card_id=1)
    tx = session.get(Transaction, 10)
    tx.is_refund = False
    tx.confirmed = False
    session.commit()
    with pytest.raises(actions.ActionError,
                       match=r"The payment 'Albert Heijn · 12 Nov' was changed again after that card \(card 1\), so it cannot be undone"):
        actions.preview("card.undo", {"card_id": 1})


def test_undo_of_a_card_with_no_record_is_refused(session):
    with pytest.raises(actions.ActionError, match="There is no record of what card 99 changed"):
        actions.preview("card.undo", {"card_id": 99})


def test_a_preview_keeps_nothing(session):
    actions.preview("transaction.update", {"id": 10, "category_id": 2})
    assert session.query(AppliedChange).count() == 0


def test_undoing_a_removed_manual_entry_brings_it_back_with_its_own_id(session):
    session.add(Transaction(id=20, date=date(2026, 11, 13), amount=Decimal("-3.00"), description="Market",
                            source="manual", import_hash="m-20", category_id=1, confirmed=True))
    session.commit()
    apply("transaction.delete", {"id": 20}, card_id=1)
    session.expire_all()
    assert session.get(Transaction, 20) is None
    apply("card.undo", {"card_id": 1}, card_id=2)
    session.expire_all()
    back = session.get(Transaction, 20)
    assert back is not None and back.description == "Market" and back.amount == Decimal("-3.00")
    assert back.date == date(2026, 11, 13) and back.source.value == "manual"


def test_a_bank_row_can_be_removed_and_a_later_import_does_not_bring_it_back(session):
    session.add(TransactionSplit(id=5, transaction_id=10, category_id=1, amount=Decimal("-2.50")))
    session.add(TransactionSplit(id=6, transaction_id=10, category_id=2, amount=Decimal("-2.00")))
    session.commit()
    said = lines("transaction.delete", {"id": 10})
    assert said == ["Remove the bank row: Albert Heijn · 12 Nov · -⁠€4,50 (a later import will not bring it back)"]

    apply("transaction.delete", {"id": 10}, card_id=1)
    session.expire_all()
    assert session.get(Transaction, 10) is None
    assert session.query(TransactionSplit).count() == 0
    kept_out = session.get(RemovedBankRow, "ah-12")
    assert kept_out.description == "Albert Heijn" and kept_out.amount == Decimal("-4.50")

    same = ParsedTransaction(date(2026, 11, 12), Decimal("-4.50"), "Albert Heijn", "ing", "ah-12")
    other_language = ParsedTransaction(date(2026, 11, 12), Decimal("-4.50"), "Albert Heijn", "ing", "ah-12-nl")
    new = ParsedTransaction(date(2026, 11, 14), Decimal("-9.00"), "Jumbo", "ing", "jumbo-14")
    assert import_service.already_here([same, new], session) == [True, False]
    assert import_service.already_here([other_language, new], session) == [True, False]
    assert import_service.already_here([same, other_language], session) == [True, False]  # one row answers for one


def test_undoing_a_removed_bank_row_brings_it_back_and_lets_it_in_again(session):
    session.add(TransactionSplit(id=5, transaction_id=10, category_id=1, amount=Decimal("-2.50")))
    session.add(TransactionSplit(id=6, transaction_id=10, category_id=2, amount=Decimal("-2.00")))
    session.commit()
    apply("transaction.delete", {"id": 10}, card_id=1)
    assert lines("card.undo", {"card_id": 1}) == [
        "Bring back the bank row: Albert Heijn · 12 Nov · -⁠€4,50, in Split: Groceries -€2,50 + Eating out -€2,00",
    ]
    apply("card.undo", {"card_id": 1}, card_id=2)
    session.expire_all()
    back = session.get(Transaction, 10)
    assert back.import_hash == "ah-12" and back.source.value == "ing"
    assert sorted(s.id for s in back.splits) == [5, 6]
    assert session.get(RemovedBankRow, "ah-12") is None


def test_a_bank_row_paid_from_a_set_aside_must_be_unlinked_first(session):
    session.add(SetAside(id=3, name="Car insurance", amount=Decimal("400"), start_month=date(2026, 1, 1),
                         due_month=date(2026, 11, 1), every_months=12))
    session.get(Transaction, 10).set_aside_id = 3
    session.commit()
    with pytest.raises(actions.ActionError, match="paid from the set-aside 'Car insurance' \\(id 3\\). Unlink it first"):
        actions.preview("transaction.delete", {"id": 10})
    batch = {"changes": [{"op": "set_aside.unpay", "args": {"id": 3, "transaction_id": 10}},
                         {"op": "transaction.delete", "args": {"id": 10}}]}
    apply("batch", batch, card_id=1)
    session.expire_all()
    assert session.get(Transaction, 10) is None


def test_the_transactions_page_still_cannot_delete_a_bank_row(session):
    from fastapi import HTTPException
    from routers import transactions as transactions_router
    with pytest.raises(HTTPException):
        transactions_router.delete_transaction(10, session)


# ---- The Undo button ------------------------------------------------------------------------------------------

def card(status="applied", until=None, **result) -> dict:
    return {"id": 7, "status": status, "preview": {"data": {}}, "result": {**result, "undo_until": until}}


def test_an_applied_card_offers_undo_for_a_week(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 21, 12, 0))
    soon = (datetime(2026, 11, 21, 12, 0) + timedelta(days=1)).isoformat()
    gone = (datetime(2026, 11, 21, 12, 0) - timedelta(minutes=1)).isoformat()
    undo = {"action": "undo_card", "label": "Undo", "style": "quiet"}
    assert bot.card_buttons(card(until=soon), {"channel": "telegram", "payload": {}}) == [undo]
    assert bot.card_buttons(card(until=gone), {"channel": "telegram", "payload": {}}) == []
    assert bot.card_buttons(card(until=soon), {"channel": "bubble", "payload": {"undone": True}}) == []
    assert bot.card_buttons(card(status="open", until=soon), {"channel": "bubble", "payload": {}}) == []
    # A card applied before the app kept what cards change has no Undo.
    assert bot.card_buttons({**card(), "result": {}}, {"channel": "bubble", "payload": {}}) == []
    offer = {"transaction_ids": [1], "label": "Remember Jumbo for next time"}
    assert bot.card_buttons(card(until=soon, offer=offer), {"channel": "telegram", "payload": {}}) == [
        {"action": "remember_shops", "label": "Remember Jumbo for next time"}, undo]


def test_tapping_undo_offers_an_undo_card(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 21, 12, 0))
    offered, said = [], []

    class FakeBot:
        def offer(self, channel, kind, summary, args, reply_to=None, note=None):
            offered.append((channel, kind, summary, args, reply_to))
            return 8

    monkeypatch.setattr(bot, "bot", lambda: FakeBot())

    class Ctx:
        channel = "telegram"
        message = {"id": 40, "payload": {}, "card": {**card(until="2026-11-25T12:00:00"), "summary": "Move AH"}}

        def say(self, *a, **k):
            said.append(a)

    bot.undo_card(Ctx())
    assert offered == [("telegram", "card.undo", "Undo: Move AH", {"card_id": 7}, 40)]
    Ctx.message = {**Ctx.message, "card": {**Ctx.message["card"], "result": {"undo_until": "2026-11-20T12:00:00"}}}
    bot.undo_card(Ctx())
    assert len(offered) == 1 and "more than a week old" in said[0][1]


def test_an_undone_card_is_shown_to_claude_as_undone():
    message = {"kind": "card", "role": "assistant", "payload": {"undone": True},
               "card": {"id": 7, "summary": "Move AH", "kind": "transaction.update", "status": "applied", "data": {}}}
    assert bot.history_entry(message)["card"]["undone"] is True


def test_importing_a_removed_bank_row_again_counts_it_as_skipped(session):
    apply("transaction.delete", {"id": 10}, card_id=1)
    same = ParsedTransaction(date(2026, 11, 12), Decimal("-4.50"), "Albert Heijn", "ing", "ah-12")
    outcome = import_service.import_rows([same], session)
    assert (outcome.imported, outcome.skipped) == (0, 1)
    assert session.query(Transaction).count() == 0


def test_an_applied_undo_marks_the_card_it_undid(tmp_path, monkeypatch):
    from botkit.store import Store
    store = Store(tmp_path / "bot.db")
    with store.write() as db:
        db.execute("INSERT INTO bot_conversations (channel, created_at) VALUES ('telegram', 'now')")
        db.execute("INSERT INTO bot_messages (id, conversation_id, channel, role, kind, payload, delivered, created_at) "
                   "VALUES (40, 1, 'telegram', 'assistant', 'card', '{}', '[1]', 'now')")
        db.execute("INSERT INTO bot_cards (id, message_id, conversation_id, channel, kind, summary, args, preview, "
                   "version, status, created_at) VALUES (7, 40, 1, 'telegram', 'transaction.update', 'Move AH', '{}', "
                   "'{}', 'v', 'applied', 'now')")
    monkeypatch.setattr(bot, "bot", lambda: type("B", (), {"store": store})())
    assert bot._undone_cards("batch", {"changes": [{"op": "card.undo", "args": {"card_id": 7}},
                                                   {"op": "rule.delete", "args": {"id": 1}}]}) == [7]
    bot._mark_undone(bot._undone_cards("card.undo", {"card_id": 7}))
    payload = store.message(40)["payload"]
    assert payload["undone"] is True and payload["refresh"] is True  # Telegram edits it, taking Undo away
