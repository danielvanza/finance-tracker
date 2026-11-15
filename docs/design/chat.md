# Chat
- **Claude's words always go through `Rich`** (`chat/cards.tsx`): answers, a card's sentence and a question with choices alike, so `**bold**` and list lines never show as typed.
- **The change leads its card.** The card's change lines are `--ink` at weight 500; Claude's sentence above them stays `--text`; the note and the budget effect are `--quiet`.
- **A choice is one row:** the payment's name on the left, date and amount right-aligned in tabular figures (`--text`, inheriting the disabled colour). The shared button centres its content, so `.chat-options .btn` sets `justify-content: stretch`.
- **The thread follows new steps only for a reader at its end** (within 80px); someone who scrolled up to read stays where they are. New messages always scroll it.
