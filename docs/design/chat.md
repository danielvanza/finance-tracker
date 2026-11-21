# Chat
The chat is bot-kit's default bubble (`bot-kit/bubble`, inline) inside finance's own round button and panel/sheet
(`chat/Chat.tsx`). Its look is finance's: `styles/chat.css` maps every `--bk-*` variable to finance's tokens, so day and
night follow by themselves, and sets finance's type (Geist, sentence case: the kit's tracked capitals are put back to the label style) and the spring press.
Finance's own kinds and card extras are in `chat/kinds.tsx`; what they carry is in `docs/bot.md`.
- **Claude's words always go through the kit's `Rich`**: answers, a card's sentence and a question with choices alike, so `**bold**` and list lines never show as typed.
- **The change leads its card.** The card's change lines are `--ink` at weight 500; Claude's sentence above them stays `--text`; the note and the budget effect (`.hf-effect`) are `--quiet`.
- **A choice is one row:** the payment's name on the left, date and amount right-aligned in tabular figures.
- **The thread follows new steps only for a reader at its end** (within 80px); someone who scrolled up to read stays where they are. New messages always scroll it.
- **The model picker** sits under the title, a pressed-in well; a runner that cannot answer is greyed out with its reason. **Starters** in an empty chat depend on the page (`bot.starters`).
- **A long card folds its rows** ("Show all N rows") in the bubble; Telegram gets a Show all button instead.
- **Phone first.** The sheet is 92dvh (at most 52rem); the model choice is a quiet line under the title (full-height tap target, negative margin) so the thread gets the room; the composer grows to about three lines, then scrolls. A tablet (600-1023 px) gets the same sheet centred at 36rem; a phone on its side (height up to 520 px) gets it full height without the grab handle.
- **Docked panel.** The round button is gone while the panel is open, so the page's right lane is given back (`padding-right: 1.5rem`), and below 1680 px the Overview stacks to one column and a 3.5rem figure.
- **A stale card** is a sunk well, never a coloured edge.
- **A file made in the chat** is one row under the answer's words, like a choice: a download icon and the file name left, the row count right (`Answer` in `kinds.tsx` draws answers for this, otherwise as the kit does).
