# Telegram messages
The bot writes Telegram's HTML (`parse_mode: HTML`). Only bold, italics, quotes and fixed-width blocks are used. Text from the bank, a person or Claude is always escaped (`esc`); a layout Telegram refuses is sent again as plain text.

- **Bold is for the one thing to recognise.** Who was paid in a question, the count on a long card, "Applied.", a heading over rows. Never a whole sentence, never an amount.
- **A quote sets the budget apart.** What a change does to a budget line stands in a quote under the card's lines, before and after Apply. Nothing else on a card is quoted.
- **A card before Apply** keeps this order: Claude's words, the count in bold, one line per category without the shops, any note, the budget quote. Its third button counts payments: "Show all 33 payments".
- **A card after Apply** is one sentence after a bold "Applied." (a card of a few changes keeps a line each), the budget quote, then how many payments still wait when it sorted waiting ones.
- **A question** opens with who was paid in bold and the count and total, lists up to three payments with what the payer typed in italics and curly quotes, and asks last, just above the buttons.
- **Every row of a card** ("Show all") comes as a bold heading per kind of change with its count, and the payments under it in a fixed-width block of date, amount and name. A line is at most `MONO_WIDTH` characters so it does not wrap on a phone: the name is cut, never the date or the amount, and the amount drops "€" and the minus sign.
- **Claude's own words** may carry `**bold**` for a few leads and `- ` list lines, which get a real bullet. A list of more than `FOLD_OVER` items becomes a folded quote, so what matters must stand outside it. A closing question comes last, in bold. The web chat shows the same bold and bullets, unfolded.
- **Remembering a shop is offered, never done unasked.** An answered question and an applied card get one button ("Remember J Jansen for next time", "Remember these 25 shops"); pressing it removes the button and adds a line saying what was remembered.
- **One message per thing.** A card, a question and an applied card each stay one message that is edited in place. A message too long for Telegram is cut between lines, and a quote or block open at the cut is closed and opened again (`_chunks`).
