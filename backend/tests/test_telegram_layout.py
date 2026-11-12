"""How the bot lays its messages out: Telegram's HTML, with the text in it escaped."""
import re

import telegram_bot as bot

TAG = re.compile(r"<(/?)(b|i|pre|blockquote)( expandable)?>")


def balanced(text: str) -> bool:
    open_tags = []
    for tag in TAG.finditer(text):
        if not tag.group(1):
            open_tags.append(tag.group(2))
        elif not open_tags or open_tags.pop() != tag.group(2):
            return False
    return not open_tags and "<" not in TAG.sub("", text)


def card(**values) -> dict:
    return {
        "id": 7, "status": "pending", "version": "v1", "lines": ["Sample Shop · 5 Sep · -€10,00: now Clothing"],
        "summed_up": False, "rows": 1, "payments": 1, "head": None, "short_lines": None, "applied_line": None,
        "effect_lines": [], "says": None, "summary": "", "note": None, "purchase": None, "error": None,
        "heading": "Proposed change", "apply_label": "Apply", "reject_label": "Not this",
        "waiting": None, "offer": None, "remembered": None, **values,
    }


def test_claudes_words_get_bold_leads_bullets_and_a_folded_long_list():
    text = "**96 wait**, at A&B <now>.\n- one\n- two\n\nGroups:\n" + "\n".join(f"- item {i}" for i in range(7)) + "\n**Where to start?**"
    shown = bot.rich(text)
    assert shown.startswith("<b>96 wait</b>, at A&amp;B &lt;now&gt;.\n• one\n• two\n\nGroups:\n")
    assert "<blockquote expandable>item 0\nitem 1" in shown and "item 6</blockquote>\n<b>Where to start?</b>" in shown
    assert balanced(shown)
    # Six items are a list, not a fold; a lone asterisk or a hyphen inside a line is left alone.
    assert "blockquote" not in bot.rich("\n".join(f"- item {i}" for i in range(6)))
    assert bot.rich("2 * 3 - 1 and **bold**") == "2 * 3 - 1 and <b>bold</b>"


def test_a_long_message_is_cut_between_lines_with_its_quote_reopened():
    quote = "<blockquote expandable>" + "\n".join(f"line {i} " + "x" * 60 for i in range(150)) + "</blockquote>"
    pieces = bot._chunks(f"<b>Heading</b>\n{quote}\nafter")
    assert len(pieces) > 1
    assert all(len(piece) <= bot.TEXT_LIMIT and balanced(piece) for piece in pieces)
    assert pieces[1].startswith("<blockquote expandable>line ")
    assert bot.plain_text("\n".join(pieces)).count("line ") == 150


def test_a_long_card_says_its_count_in_bold_without_shops_and_sets_the_budget_apart():
    text, buttons = bot.render_card(card(
        says="Trip payments. **Check** the bar.", summed_up=True, rows=33, payments=33, head="33 payments",
        lines=["33 payments:", "• Move to Rec & Fun: 31 payments, €411,03 (metro ×9, cafe and 20 more)"],
        short_lines=["• Move to Rec & Fun: 31 payments, €411,03", "• Confirm as Rec & Fun: 2 payments, €40,75"],
        effect_lines=["Rec & Fun this month: €123,66 → €575,44 of €100,00"],
    ))
    assert text == (
        "Trip payments. <b>Check</b> the bar.\n\n<b>33 payments</b>\n"
        "• Move to Rec &amp; Fun: 31 payments, €411,03\n• Confirm as Rec &amp; Fun: 2 payments, €40,75\n"
        "<blockquote>Rec &amp; Fun this month: €123,66 → €575,44 of €100,00</blockquote>"
    )
    assert [[b["text"] for b in row] for row in buttons] == [["Apply", "Not this"], ["Show all 33 payments"]]


def test_an_applied_card_is_a_sentence_the_budget_and_what_is_left():
    applied = card(
        status="applied", summed_up=True, rows=33, payments=33, lines=["33 payments:", "• Move to …"],
        applied_line="33 payments are now in Rec & Fun, €451,78 in all.",
        effect_lines=["Rec & Fun this month: €575,44 of €100,00"], waiting=63, offer="Remember these 25 shops",
    )
    text, buttons = bot.render_card(applied)
    assert text == (
        "<b>Applied.</b> 33 payments are now in Rec &amp; Fun, €451,78 in all.\n"
        "<blockquote>Rec &amp; Fun this month: €575,44 of €100,00</blockquote>\n63 payments still wait."
    )
    assert buttons == [[{"text": "Remember these 25 shops", "callback_data": "m:7"}]]
    # Once the offer is taken up the button goes and the message says what was remembered.
    text, buttons = bot.render_card({**applied, "offer": None, "remembered": "Remembered 25 shops for next time.", "waiting": 0})
    assert text.endswith("</blockquote>\nNothing is waiting any more.\nRemembered 25 shops for next time.")
    assert buttons is None
    # A card of one change keeps its own line; one of a few keeps a line each.
    assert bot.render_card(card(status="applied"))[0] == "<b>Applied.</b> Sample Shop · 5 Sep · -€10,00: now Clothing"
    assert bot.render_card(card(status="applied", lines=["One", "Two"], waiting=1))[0] == "<b>Applied.</b>\nOne\nTwo\n1 payment still waits."
    # A row too long for one message is cut, so the applied card stays one message.
    long = bot.render_card(card(status="applied", lines=["Add: " + "x" * 5000], effect_lines=["Misc this month: €1,00"]))[0]
    assert len(long) <= bot.TEXT_LIMIT and long.endswith("…\n<blockquote>Misc this month: €1,00</blockquote>")


def question(**payload) -> dict:
    return {"id": 3, "text": "", "payload": {
        "status": "open", "name": "J Jansen", "incoming": False, "count": 2, "total_cents": -34500,
        "examples": [
            {"date_label": "7 Sep", "amount_label": "-€45,00", "description": "J Jansen", "note": "etentje <vrijdag>"},
            {"date_label": "31 Aug", "amount_label": "-€300,00", "description": "J Jansen", "note": ""},
        ],
        "options": [{"label": "To personal accounts"}, {"label": "Miscellaneous"}], **payload,
    }}


def test_a_question_names_who_was_paid_shows_the_notes_and_asks_last():
    text, buttons = bot.render_question(question())
    assert text == (
        "<b>J Jansen</b> · 2 payments, €345,00\n7 Sep · -€45,00 · <i>“etentje &lt;vrijdag&gt;”</i>\n31 Aug · -€300,00\n\n"
        "Where does it belong?"
    )
    assert [row[0]["text"] for row in buttons] == ["To personal accounts", "Miscellaneous", "Something else"]
    one = question(count=1, total_cents=4500, incoming=True)
    one["payload"]["examples"] = one["payload"]["examples"][:1]
    assert bot.render_question(one)[0] == "<b>J Jansen</b> · 7 Sep · -€45,00 · <i>“etentje &lt;vrijdag&gt;”</i>\n\nWhat was this money for?"
    many = bot.render_question(question(count=5))[0]
    assert "\nand 3 more\n\nWhere does it belong?" in many


def test_an_answered_question_offers_to_remember_the_shop():
    answered = question(status="answered", result="To personal accounts. 2 payments sorted.",
                        offer={"transaction_id": 9, "label": "Remember J Jansen for next time"})
    text, buttons = bot.render_question(answered)
    assert text == "J Jansen: To personal accounts. 2 payments sorted."
    assert buttons == [[{"text": "Remember J Jansen for next time", "callback_data": "q:3:m"}]]
    del answered["payload"]["offer"]
    assert bot.render_question(answered)[1] is None


def test_every_row_of_a_card_comes_in_columns_under_bold_headings():
    shown = bot.render_details([
        {"heading": "Misc → Rec & Fun", "rows": [
            {"when": "8 Oct", "amount": "-⁠€63,03", "name": "KIOSK ROSSIO 08091505 LISBOA PRT"},
            {"when": "28 Sep", "amount": "-⁠€1.163,45", "name": "DN"},
            {"when": "2 Oct", "amount": "+€5,00", "name": "Back <again>"},
        ]},
        {"heading": "Remembered for next time", "lines": ["“kiosk rossio” → Rec & Fun"]},
    ])
    assert shown == (
        "<b>Misc → Rec &amp; Fun</b> · 3\n"
        "<pre>8 Oct     63,03  KIOSK ROSSIO 080…\n28 Sep 1.163,45  DN\n2 Oct     +5,00  Back &lt;again&gt;</pre>\n"
        "<b>Remembered for next time</b> · 1\n“kiosk rossio” → Rec &amp; Fun"
    )
    assert all(len(line) <= bot.MONO_WIDTH for line in bot.plain_text(shown.split("<pre>")[1].split("</pre>")[0]).split("\n"))
    assert bot.render_details([{"heading": "Other changes", "lines": ["A & B"]}]) == "• A &amp; B"
