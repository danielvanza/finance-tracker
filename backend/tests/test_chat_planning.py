"""What the chat can change about plans, categories and settings: category.merge, budget.copy, budget.adjust,
and the settings nudges, quiet_hours and sort_model."""
from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import clock
import db as database
import runtime_settings
from assistant import actions
from assistant.actions import ActionError
from db import Base
from models import AskShop, Budget, Category, CategoryType, Rule, Setting, Transaction, TransactionSplit


def add_category(db, name, type_="wants", order=1) -> Category:
    cat = Category(name=name, type=CategoryType(type_), sort_order=order)
    db.add(cat)
    db.commit()
    return cat


def plan(db, category, month, amount):
    db.add(Budget(category_id=category.id, month=month, planned_amount=Decimal(amount)))
    db.commit()


def run(db, op, **args):
    actions._run_op(op, args, db)


def planned(db, category, month) -> Decimal:
    from routers import budget as budget_router
    return budget_router.planned_for(db, month)[category.id]


def payment(db, category, n=1, amount="-10.00", confirmed=True, **extra) -> Transaction:
    tx = Transaction(date=date(2026, 11, n), amount=Decimal(amount), description=f"Shop {n}", source="ing",
                     import_hash=f"h-{category.id}-{n}-{amount}", category_id=category.id, confirmed=confirmed,
                     categorised_by="manual", **extra)
    db.add(tx)
    db.commit()
    return tx


# ---- category.merge ------------------------------------------------------------------------------

def test_merge_moves_payments_splits_rules_and_removes_the_category(db):
    takeaway, food = add_category(db, "Takeaway"), add_category(db, "Eating out", order=2)
    kept = payment(db, takeaway, 1)
    split = payment(db, food, 2, "-30.00")
    db.add_all([TransactionSplit(transaction_id=split.id, category_id=takeaway.id, amount=Decimal("-20.00")),
                TransactionSplit(transaction_id=split.id, category_id=food.id, amount=Decimal("-10.00"))])
    waiting = payment(db, takeaway, 3, confirmed=False, ai_options=[takeaway.id, 99])
    db.add_all([Rule(pattern="dominos", category_id=takeaway.id), Rule(pattern="thuisbezorgd", category_id=takeaway.id),
                Rule(pattern="Thuisbezorgd", category_id=food.id), AskShop(pattern="mcdonalds")])
    db.commit()
    ids = (takeaway.id, food.id)

    run(db, "category.merge", from_id=ids[0], into_id=ids[1])

    db.expire_all()
    assert db.get(Category, ids[0]) is None
    assert db.get(Transaction, kept.id).category_id == ids[1]
    assert {s.category_id for s in db.query(TransactionSplit)} == {ids[1]}
    assert db.get(Transaction, waiting.id).ai_options == [ids[1], 99]
    assert {(r.pattern, r.category_id) for r in db.query(Rule)} == {("dominos", ids[1]), ("Thuisbezorgd", ids[1])}
    assert db.query(AskShop).count() == 1


def test_merge_adds_the_plans_so_the_total_stays_the_same(db):
    takeaway, food = add_category(db, "Takeaway"), add_category(db, "Eating out", order=2)
    plan(db, takeaway, None, "40")
    plan(db, food, None, "100")
    plan(db, takeaway, date(2026, 10, 1), "40")
    plan(db, food, date(2026, 10, 1), "100")
    plan(db, takeaway, date(2026, 11, 1), "60")  # the target has no row in November: it carries 100
    plan(db, takeaway, date(2026, 12, 1), "60")
    plan(db, food, date(2026, 12, 1), "120")
    months = [date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1), date(2027, 3, 1)]
    before = {m: planned(db, takeaway, m) + planned(db, food, m) for m in months}

    run(db, "category.merge", from_id=takeaway.id, into_id=food.id)

    db.expire_all()
    assert {m: planned(db, food, m) for m in months} == before
    assert db.query(Budget).filter_by(month=None, category_id=food.id).one().planned_amount == Decimal("140")
    assert db.query(Budget).filter(Budget.category_id == takeaway.id).count() == 0


def test_merge_moves_the_savings_goal_or_refuses_two(db):
    a, b = add_category(db, "Holiday pot", "savings"), add_category(db, "Trips", "savings", 2)
    run(db, "goal.set", category_id=a.id, name="Italy", target_cents=100000)

    run(db, "category.merge", from_id=a.id, into_id=b.id)
    db.expire_all()
    from routers import goals as goals_router
    assert [(g["n"], g["c"]) for g in goals_router._stored(db)] == [("Italy", b.id)]

    c = add_category(db, "Car pot", "savings", 3)
    run(db, "goal.set", category_id=c.id, name="Car", target_cents=500000)
    with pytest.raises(ActionError, match="Both Car pot and Trips have a savings goal"):
        run(db, "category.merge", from_id=c.id, into_id=b.id)
    assert db.get(Category, c.id) is not None


def test_merge_refusals(db):
    takeaway, groceries = add_category(db, "Takeaway", "wants"), add_category(db, "Groceries", "needs", 2)
    with pytest.raises(ActionError, match="Takeaway is a want and Groceries is a need; change one's type first"):
        run(db, "category.merge", from_id=takeaway.id, into_id=groceries.id)
    with pytest.raises(ActionError, match="cannot be merged into itself"):
        run(db, "category.merge", from_id=takeaway.id, into_id=takeaway.id)
    with pytest.raises(ActionError, match="category to merge into does not exist"):
        run(db, "category.merge", from_id=takeaway.id, into_id=999)


# ---- budget.copy and budget.adjust ---------------------------------------------------------------

def budgeted(db):
    food, fun = add_category(db, "Food", "needs"), add_category(db, "Fun", "wants", 2)
    save = add_category(db, "Pot", "savings", 3)
    for cat, october, november in ((food, "300", "350"), (fun, "100", "100"), (save, "50", "75")):
        plan(db, cat, date(2026, 10, 1), october)
        plan(db, cat, date(2026, 11, 1), november)
    return food, fun, save


def test_copy_sets_the_months_plans_from_another_month_and_carries_forward(db):
    food, fun, save = budgeted(db)
    plan(db, food, date(2026, 12, 1), "350")
    plan(db, save, date(2026, 12, 1), "75")
    plan(db, fun, date(2026, 12, 1), "100")

    args = {"from_month": "2026-10", "to_month": "2026-11"}
    actions.OPS["budget.copy"].prepare(db, args)
    run(db, "budget.copy", **args)

    assert [planned(db, c, date(2026, 11, 1)) for c in (food, fun, save)] == [Decimal(300), Decimal(100), Decimal(50)]
    assert planned(db, food, date(2026, 12, 1)) == Decimal(300)  # December still held November's old amount
    assert planned(db, food, date(2026, 10, 1)) == Decimal(300)


def test_copy_refusals(db):
    budgeted(db)
    with pytest.raises(ActionError, match="from_month is missing"):
        run(db, "budget.copy", to_month="2026-11")
    with pytest.raises(ActionError, match="from_month is not valid"):
        run(db, "budget.copy", from_month="October")
    with pytest.raises(ActionError, match="are the same"):
        run(db, "budget.copy", from_month="2026-11", to_month="2026-11")


def test_adjust_by_percent_rounds_to_whole_euros(db):
    food, fun, save = budgeted(db)
    plan(db, food, date(2026, 12, 1), "350")

    run(db, "budget.adjust", month="2026-11", type="wants", by_pct=-10)
    run(db, "budget.adjust", month="2026-11", category_ids=[food.id], by_pct=3)  # 350 -> 360.5 -> 361

    assert planned(db, fun, date(2026, 11, 1)) == Decimal(90)
    assert planned(db, food, date(2026, 11, 1)) == Decimal(361)
    assert planned(db, food, date(2026, 12, 1)) == Decimal(361)  # carried to the month that held the old amount
    assert planned(db, save, date(2026, 11, 1)) == Decimal(75)


def test_adjust_by_cents_never_goes_below_zero(db):
    food, fun, save = budgeted(db)
    run(db, "budget.adjust", month="2026-11", category_ids=[fun.id, save.id], by_cents=-8000)
    assert planned(db, fun, date(2026, 11, 1)) == Decimal(20)
    assert planned(db, save, date(2026, 11, 1)) == Decimal(0)
    run(db, "budget.adjust", month="2026-11", category_ids=[food.id], by_cents=2050)  # 370.50 -> 371
    assert planned(db, food, date(2026, 11, 1)) == Decimal(371)


def test_adjust_refusals(db):
    food, _, _ = budgeted(db)
    income = add_category(db, "Salary", "income", 9)
    for args, message in [
        ({"by_pct": 5}, "either category_ids or type"),
        ({"type": "wants", "category_ids": [food.id], "by_pct": 5}, "either category_ids or type"),
        ({"type": "income", "by_pct": 5}, "needs, wants or savings"),
        ({"type": "wants"}, "either by_pct or by_cents"),
        ({"type": "wants", "by_pct": 5, "by_cents": 100}, "either by_pct or by_cents"),
        ({"type": "wants", "by_pct": 2.5}, "not a whole number"),
        ({"type": "wants", "by_pct": -101}, "more than 100%"),
        ({"category_ids": [food.id, food.id], "by_pct": 5}, "listed twice"),
        ({"category_ids": [income.id], "by_pct": 5}, "Salary has no plan"),
        ({"category_ids": [999], "by_pct": 5}, "does not exist"),
        ({"type": "wants", "by_pct": 5, "month": "nope"}, "month is not valid"),
    ]:
        with pytest.raises(ActionError, match=message):
            run(db, "budget.adjust", **args)


def test_adjust_inside_a_batch_populates_the_month_first(db):
    food, fun, _ = budgeted(db)
    args = {"changes": [{"op": "budget.adjust", "args": {"month": "2026-12", "type": "needs", "by_pct": 10}}]}
    actions.OPS["batch"].prepare(db, args)
    run(db, "batch", **args)
    assert planned(db, food, date(2026, 12, 1)) == Decimal(385)
    assert planned(db, food, date(2026, 11, 1)) == Decimal(350)


# ---- settings --------------------------------------------------------------------------------------

@pytest.fixture
def settings(db, monkeypatch):
    """The clock and the sorter read settings through their own session: point it at the test database."""
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=db.get_bind()))
    for name in ("NUDGES", "SORT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    runtime_settings.forget()
    yield db
    runtime_settings.forget()


def set_setting(db, key, value):
    run(db, "setting.set", key=key, value=value)
    runtime_settings.forget()


def at(hour):
    return datetime(2026, 11, 21, hour, 30)


def test_nudges_setting_wins_over_the_environment(settings, monkeypatch):
    assert runtime_settings.nudges_on()
    monkeypatch.setenv("NUDGES", "off")
    runtime_settings.forget()
    assert not runtime_settings.nudges_on()
    set_setting(settings, "nudges", "on")
    assert runtime_settings.nudges_on()
    set_setting(settings, "nudges", "off")
    monkeypatch.delenv("NUDGES")
    runtime_settings.forget()
    assert not runtime_settings.nudges_on()


def test_nudge_rounds_and_unasked_questions_do_nothing_when_off(settings, monkeypatch):
    import nudges
    from assistant import questions
    set_setting(settings, "nudges", "off")
    assert nudges.tick(at(12)) == []
    assert questions.ask_questions(unasked=True) == 0


def test_quiet_hours_default_and_setting(settings):
    assert [clock.quiet_hours(at(h)) for h in (8, 9, 20, 21, 23, 0)] == [True, False, False, True, True, True]
    set_setting(settings, "quiet_hours", "22-7")
    assert [clock.quiet_hours(at(h)) for h in (6, 7, 21, 22, 0)] == [True, False, False, True, True]
    set_setting(settings, "quiet_hours", "1-5")  # not across midnight
    assert [clock.quiet_hours(at(h)) for h in (0, 1, 4, 5, 22)] == [False, True, True, False, False]


def test_quiet_hours_setting_is_checked(settings):
    for bad in ("21", "21-21", "24-9", "9-", "a-b", "21-9-3", "-3-4", "21:00-9:00"):
        with pytest.raises(ActionError, match="Quiet hours are two different whole hours"):
            run(settings, "setting.set", key="quiet_hours", value=bad)


def test_a_broken_database_never_breaks_quiet_hours(monkeypatch):
    def broken():
        raise RuntimeError("no database")

    monkeypatch.setattr(database, "SessionLocal", broken)
    runtime_settings.forget()
    assert clock.quiet_hours(at(22)) and not clock.quiet_hours(at(12))
    runtime_settings.forget()


def test_settings_are_read_through_a_cache(settings):
    set_setting(settings, "quiet_hours", "22-7")
    assert clock.quiet_hours(at(21)) is False
    settings.query(Setting).filter_by(key="quiet_hours").one().value = "20-7"
    settings.commit()
    assert clock.quiet_hours(at(21)) is False  # still the cached value
    runtime_settings.forget()
    assert clock.quiet_hours(at(21)) is True


def test_sort_model_setting_wins_over_the_environment(settings, monkeypatch):
    assert runtime_settings.sort_model() == "sonnet"
    monkeypatch.setenv("SORT_MODEL", "haiku")
    runtime_settings.forget()
    assert runtime_settings.sort_model() == "haiku"
    set_setting(settings, "sort_model", "opus")
    assert runtime_settings.sort_model() == "opus"
    with pytest.raises(ActionError, match="one of sonnet, opus, haiku"):
        run(settings, "setting.set", key="sort_model", value="gpt")


def test_unknown_setting_names_the_allowed_ones(db):
    with pytest.raises(ActionError, match="nudges, quiet_hours, sort_model"):
        run(db, "setting.set", key="colour", value="red")


def test_get_settings_lists_the_defaults(settings, monkeypatch):
    from routers import settings as settings_router
    got = settings_router.get_settings(settings)
    assert (got["nudges"], got["quiet_hours"], got["sort_model"]) == ("on", "21-9", "sonnet")
    settings_router.patch_setting("sort_model", settings_router.SettingPatch(value="haiku"), settings)
    assert settings_router.get_settings(settings)["sort_model"] == "haiku"


# ---- the card -----------------------------------------------------------------------------------------

@pytest.fixture
def real_engine(tmp_path, monkeypatch):
    """actions.preview runs on the app's own engine: give it a throwaway file."""
    engine = create_engine(f"sqlite:///{tmp_path / 'f.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=engine))
    runtime_settings.forget()
    with sessionmaker(bind=engine)() as session:
        yield session
    runtime_settings.forget()


def test_the_merge_card_says_what_happens(real_engine):
    db = real_engine
    takeaway, food = add_category(db, "Takeaway"), add_category(db, "Eating out", order=2)
    for n in range(1, 6):
        payment(db, takeaway, n)
    db.add_all([Rule(pattern="dominos", category_id=takeaway.id), Rule(pattern="thuisbezorgd", category_id=takeaway.id)])
    db.commit()
    plan(db, takeaway, date(2026, 11, 1), "40")
    plan(db, food, date(2026, 11, 1), "100")

    card = actions.plain(actions.preview("category.merge", {"from_id": takeaway.id, "into_id": food.id}))

    assert card["summed_up"]
    assert card["lines"] == [
        "5 payments:",
        "• Move to Eating out: 5 payments, €50,00 (shop ×5)",
        "• Removes Takeaway",
        "• 2 rules now point to Eating out",
        "• Its plan is added to the plan of Eating out, in 1 month",
    ]
    assert db.query(Category).count() == 2  # the preview changed nothing


def test_the_setting_card_uses_plain_words(real_engine):
    card = actions.plain(actions.preview("setting.set", {"key": "quiet_hours", "value": "22-7"}))
    assert card["lines"] == ["New setting: Quiet hours: from 22:00 until 7:00"]
    card = actions.plain(actions.preview("setting.set", {"key": "nudges", "value": "off"}))
    assert card["lines"] == ["New setting: Messages the bot sends unasked: Off"]
