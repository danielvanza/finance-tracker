# Shell
- **One left edge.** Phone: the top row's left padding is 1.25rem, so the brand text lands on the panel-text edge (35px at 390). Desktop: brand, Find icon, Add icon and tab labels all start 0.8rem inside the row edge (the field padding); the Find and Add hints end on the same line (Add row padding `0 0.6rem 0 0.8rem`, gap 0.5rem). The Dashboard chip sits on the tab-chip edge, pinned to the panel foot. Do not widen the Find inset: its placeholder truncates.
- **Desktop tab rows are at least 44px** (`--tap`), like Find, Add and Dashboard; the tab well follows the live size.
- **Find field text keeps a 1.3 line height**: its box clips overflow for the ellipsis, and a tighter line cuts the g and y.
- **The palette has one left edge.** The field, the list and its rows start at 0.9rem; row text, group labels and the search icon sit 0.8rem inside; the icon is centred on the field (`top: calc(50% + 0.45rem)`, set in `.pal` because the shared offset assumes a 0.6rem search padding).
- **Find and Add are in the shell on every page** (44 px chips on a phone; a pressed-in field and an Add row on desktop). Shortcuts (Ctrl/Cmd-K, N, g then a letter) are ignored while typing or when a sheet or palette is open.
- **A page opens at its top**; tapping the current tab scrolls to the top, except with a `?q=` search, which it clears.
- **A transient confirmation** sits above the chat button on a phone, in a persistent `role=status` region.
- **`/report` keeps Month as the current tab.**
