"""Reminders: the ops that set them (cards), and sending the due ones from nudges.tick."""
import json
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import clock
import db as database
import nudges
import reminders
from assistant import actions, bot as chat_bot, queries
from db import Base
from models import Reminder

NOW = datetime(2026, 11, 21, 10, 30)  # a Saturday morning


@pytest.fixture
def app(tmp_path, monkeypatch):
    """A scratch database that the actions, the sender and the lookups all use, and a scratch chat store."""
    engine = create_engine(f"sqlite:///{tmp_path / 'finance.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    for module in (reminders, nudges, queries):
        monkeypatch.setattr(module, "SessionLocal", sessions)
    monkeypatch.setenv("BOT_DB_PATH", str(tmp_path / "bot.db"))
    monkeypatch.setenv("NUDGES", "off")  # the tick then sends reminders and nothing else
    monkeypatch.setattr(chat_bot, "_bot", None)
    monkeypatch.setattr(clock, "now", lambda: NOW)
    yield sessions
    monkeypatch.setattr(chat_bot, "_bot", None)


def make(args: dict, name: str = "reminder.add") -> dict:
    return actions.apply(name, args, actions.preview(name, args), lambda conn, fresh: None, None)


def stored(sessions) -> list[Reminder]:
    with sessions() as db:
        rows = db.query(Reminder).order_by(Reminder.id).all()
        db.expunge_all()
        return rows


def sent_messages() -> list[dict]:
    store = chat_bot.bot().store
    with store.connect() as db:
        rows = db.execute("SELECT kind, text, payload FROM bot_messages WHERE kind = 'reminder' ORDER BY id").fetchall()
    return [{"text": r["text"], **json.loads(r["payload"])} for r in rows]


def refused(args: dict, name: str = "reminder.add") -> str:
    with pytest.raises(actions.ActionError) as e:
        actions.preview(name, args)
    return str(e.value)


# ---- Setting them -------------------------------------------------------------------------------

def test_a_card_for_a_new_reminder_reads_well(app):
    preview = actions.preview("reminder.add", {"text": "Move money to savings", "at": "2026-11-25"})
    assert actions.plain(preview)["lines"] == [
        "New: Reminder “Move money to savings”: Wed 25 Nov 2026 at 09:00, once"
    ]
    repeating = actions.preview("reminder.add", {"text": "Check the plan", "at": "2026-12-01T18:30", "every": "month"})
    assert actions.plain(repeating)["lines"] == ["New: Reminder “Check the plan”: Tue 1 Dec 2026 at 18:30, every month"]


def test_a_date_alone_means_nine_and_the_reminder_is_saved_on_apply(app):
    assert stored(app) == []
    make({"text": "  Move   money to savings ", "at": "2026-11-25"})
    [r] = stored(app)
    assert (r.text, r.next_at, r.anchor_at, r.every, r.created_at) == (
        "Move money to savings", datetime(2026, 11, 25, 9), datetime(2026, 11, 25, 9), None, NOW)


def test_a_night_time_is_said_to_be_held_until_morning(app):
    line = actions.plain(actions.preview("reminder.add", {"text": "Call", "at": "2026-11-25T22:00"}))["lines"][0]
    assert line == "New: Reminder “Call”: Wed 25 Nov 2026 at 22:00 (held until the morning), once"


@pytest.mark.parametrize("args, why", [
    ({"text": "", "at": "2026-11-25"}, "The reminder text is missing"),
    ({"at": "2026-11-25"}, "The reminder text is missing"),
    ({"text": "x" * 301, "at": "2026-11-25"}, "301 characters"),
    ({"text": "Hi"}, "The time is not valid"),
    ({"text": "Hi", "at": "25 November"}, "The time is not valid"),
    ({"text": "Hi", "at": "2026-13-45"}, "The time is not valid"),
    ({"text": "Hi", "at": "2026-11-25T09:00+01:00"}, "without a time zone"),
    ({"text": "Hi", "at": "2026-11-25", "every": "day"}, "every week, month or year"),
    ({"text": "Hi", "at": "2026-11-21"}, "has already passed"),  # 9:00 today, and it is 10:30
    ({"text": "Hi", "at": "2026-11-20T12:00"}, "Fri 20 Nov 2026 at 12:00 has already passed (it is Sat 21 Nov 2026 at 10:30 now)"),
])
def test_what_is_refused_and_why(app, args, why):
    assert why in refused(args)


def test_a_time_later_today_is_fine_and_this_minute_is_not_past(app):
    make({"text": "Hi", "at": "2026-11-21T10:30"})
    make({"text": "Hi", "at": "2026-11-21T23:00"})
    assert len(stored(app)) == 2


def test_a_repeating_reminder_in_the_past_moves_on_to_its_next_time(app):
    make({"text": "Rent day", "at": "2026-11-01", "every": "month"})
    [r] = stored(app)
    assert r.next_at == datetime(2026, 12, 1, 9) and r.anchor_at == datetime(2026, 11, 1, 9)
    make({"text": "Bins", "at": "2026-11-16T08:00", "every": "week"})
    assert stored(app)[1].next_at == datetime(2026, 11, 23, 8)


def test_months_without_the_day_fall_back_and_the_asked_day_comes_back():
    anchor = datetime(2026, 1, 31, 9)
    assert [reminders.occurrence(anchor, "month", n).date().isoformat() for n in range(4)] == [
        "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    leap = datetime(2024, 2, 29, 9)
    assert [reminders.occurrence(leap, "year", n).date().isoformat() for n in range(5)] == [
        "2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]
    assert reminders.occurrence(datetime(2026, 12, 15, 9), "month", 2) == datetime(2027, 2, 15, 9)


def test_update_changes_only_what_is_named(app):
    make({"text": "Move money", "at": "2026-11-25", "every": "month"})
    line = actions.plain(actions.preview("reminder.update", {"id": 1, "text": "Move money to Savings"}))["lines"]
    assert line == ["Reminder “Move money to Savings”: name Move money → Move money to Savings"]
    make({"id": 1, "at": "2026-11-26T08:15"}, "reminder.update")
    [r] = stored(app)
    assert (r.text, r.next_at, r.anchor_at, r.every) == ("Move money", datetime(2026, 11, 26, 8, 15), datetime(2026, 11, 26, 8, 15), "month")
    line = actions.plain(actions.preview("reminder.update", {"id": 1, "every": None}))["lines"]
    assert line == ["Reminder “Move money”: repeats every month → once"]
    make({"id": 1, "every": "week"}, "reminder.update")
    assert stored(app)[0].every == "week" and stored(app)[0].next_at == datetime(2026, 11, 26, 8, 15)


def test_update_and_delete_refuse_what_cannot_be_done(app):
    assert refused({"id": 9, "text": "x"}, "reminder.update") == "That reminder does not exist"
    assert refused({"id": 9}, "reminder.delete") == "That reminder does not exist"
    make({"text": "Hi", "at": "2026-11-25"})
    assert "Say what changes" in refused({"id": 1}, "reminder.update")
    assert "has already passed" in refused({"id": 1, "at": "2026-11-01"}, "reminder.update")
    assert "That would not change anything" == refused({"id": 1, "text": "Hi"}, "reminder.update")
    with app() as db:
        db.get(Reminder, 1).next_at = None  # sent
        db.commit()
    assert "already been sent" in refused({"id": 1, "text": "Hello"}, "reminder.update")


def test_delete_shows_what_goes_and_removes_it(app):
    make({"text": "Move money", "at": "2026-11-25"})
    assert actions.plain(actions.preview("reminder.delete", {"id": 1}))["lines"] == ["Removed: Reminder “Move money”"]
    make({"id": 1}, "reminder.delete")
    assert stored(app) == []


def test_reminders_can_be_batched(app):
    make({"changes": [{"op": "reminder.add", "args": {"text": "A", "at": "2026-11-25"}},
                      {"op": "reminder.add", "args": {"text": "B", "at": "2026-11-26"}}]}, "batch")
    assert [r.text for r in stored(app)] == ["A", "B"]


# ---- Sending them -------------------------------------------------------------------------------

def test_tick_sends_a_due_reminder_once_even_with_nudges_off(app):
    make({"text": "Move money to savings", "at": "2026-11-21T10:45"})
    assert nudges.tick(datetime(2026, 11, 21, 10, 40)) == [] and sent_messages() == []
    assert nudges.tick(datetime(2026, 11, 21, 10, 46)) == ["reminder"]
    assert sent_messages() == [{"text": "Move money to savings", "reminder_id": 1, "unasked": True}]
    assert nudges.tick(datetime(2026, 11, 21, 10, 47)) == [] and len(sent_messages()) == 1
    [r] = stored(app)
    assert r.next_at is None and r.last_sent_at == datetime(2026, 11, 21, 10, 46)


def test_a_reminder_in_the_quiet_hours_waits_for_the_first_allowed_moment(app):
    make({"text": "Call mum", "at": "2026-11-21T22:00"})
    assert nudges.tick(datetime(2026, 11, 21, 22, 5)) == []
    assert nudges.tick(datetime(2026, 11, 22, 8, 59)) == []
    assert sent_messages() == [] and stored(app)[0].next_at == datetime(2026, 11, 21, 22, 0)
    assert nudges.tick(datetime(2026, 11, 22, 9, 0)) == ["reminder"]
    assert [m["text"] for m in sent_messages()] == ["Call mum"]


def test_a_repeating_reminder_missed_for_weeks_is_sent_once_then_moves_to_a_future_time(app):
    make({"text": "Bins", "at": "2026-11-23T08:00", "every": "week"})
    assert nudges.tick(datetime(2026, 12, 20, 12, 0)) == ["reminder"]  # four Mondays later
    assert len(sent_messages()) == 1
    assert stored(app)[0].next_at == datetime(2026, 12, 21, 8, 0)
    assert nudges.tick(datetime(2026, 12, 20, 12, 1)) == []


def test_a_monthly_reminder_on_the_31st_keeps_the_asked_day(app):
    make({"text": "Pay", "at": "2026-12-31", "every": "month"})
    for now, next_at in [(datetime(2026, 12, 31, 9, 5), datetime(2027, 1, 31, 9)),
                         (datetime(2027, 1, 31, 9, 5), datetime(2027, 2, 28, 9)),
                         (datetime(2027, 2, 28, 9, 5), datetime(2027, 3, 31, 9))]:
        assert nudges.tick(now) == ["reminder"]
        assert stored(app)[0].next_at == next_at
    assert len(sent_messages()) == 3


def test_every_due_reminder_is_its_own_message_and_none_is_lost(app):
    make({"text": "One", "at": "2026-11-21T10:35"})
    make({"text": "Two", "at": "2026-11-21T10:36"})
    assert nudges.tick(datetime(2026, 11, 21, 11, 0)) == ["reminder", "reminder"]
    assert [m["text"] for m in sent_messages()] == ["One", "Two"]


def test_a_reminder_that_could_not_be_posted_is_tried_again(app, monkeypatch):
    make({"text": "Hi", "at": "2026-11-21T10:35"})
    def down(reminder):
        raise RuntimeError("down")

    with monkeypatch.context() as m:
        m.setattr(reminders, "_post", down)
        assert nudges.tick(datetime(2026, 11, 21, 11, 0)) == []
    assert stored(app)[0].next_at == datetime(2026, 11, 21, 10, 35)
    assert reminders.send_due(datetime(2026, 11, 21, 11, 1)) == 1


# ---- Showing them -------------------------------------------------------------------------------

def test_claude_can_look_reminders_up_and_the_chats_show_them(app):
    make({"text": "Move money", "at": "2026-11-25", "every": "month"})
    make({"text": "Done one", "at": "2026-11-21T10:35"})
    nudges.tick(datetime(2026, 11, 21, 11, 0))
    views = queries.Views()
    try:
        rows = views.run("q1", "SELECT id, text, next_at, every, status, last_sent_at FROM reminders ORDER BY id")["rows"]
    finally:
        views.close()
    assert rows == [[1, "Move money", "2026-11-25 09:00", "month", "waiting", None],
                    [2, "Done one", None, None, "done", "2026-11-21 11:00"]]

    message = {"id": 5, "kind": "reminder", "role": "assistant", "text": "Move <money> & save", "payload": {"reminder_id": 1}}
    assert chat_bot.history_entry(message) == {"from": "app", "reminder_sent": "Move <money> & save"}
    import telegram_bot
    assert telegram_bot.RENDERERS["reminder"](message).text == "Reminder: Move &lt;money&gt; &amp; save"
