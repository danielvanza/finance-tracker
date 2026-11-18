---
name: Finances
description: What is free to spend until payday, in Forest; colour means status, nothing else
# Keys equal the CSS variables in frontend/src/styles/base.css; -night is the night theme. Shadow recipes
# (--raise, --press, --float-*) and the older clay alias names live only there. series-* live in trends.css.
colors:
  accent: "#1f6f5c"
  accent-night: "#7fd8a8"
  on-accent: "#ffffff"
  on-accent-night: "#0f1a14"
  accent-soft: "#dcede5"
  accent-soft-night: "#1f3a2d"
  ok: "#2e8a55"
  ok-night: "#7fd8a8"
  watch: "#d9902b"
  watch-night: "#e8b04b"
  watch-ink: "#8f530c"
  watch-ink-night: "#e8b04b"
  over: "#b1322a"
  over-night: "#f07167"
  series-needs: "#16558c"
  series-needs-night: "#5590cc"
  series-wants: "#bf7fb9"
  series-wants-night: "#82477e"
  series-savings: "#3e7232"
  series-savings-night: "#5e9352"
  bg: "#eef1ec"
  bg-night: "#111814"
  card: "#ffffff"
  card-night: "#1a231e"
  sunk: "#e6eae4"
  sunk-night: "#151d18"
  hair: "#dde2da"
  hair-night: "#2a352f"
  ink: "#1b2420"
  ink-night: "#eceae4"
  text: "#33403a"
  text-night: "#d3d6d0"
  quiet: "#5c6862"
  quiet-night: "#a3ada6"
  muted: "#68736d"
  muted-night: "#8e9a93"
typography:
  figure: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "3.5rem", fontWeight: 650, lineHeight: 1, letterSpacing: "-0.04em" }
  figure-pair: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "clamp(2rem, 9vw, 2.75rem)", fontWeight: 650, lineHeight: 1, letterSpacing: "-0.04em" }
  heading: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "0.95rem", fontWeight: 600, lineHeight: 1.3 }
  label: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "0.95rem", fontWeight: 500, lineHeight: 1.3 }
  body: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
  small: { fontFamily: "Geist, system-ui, sans-serif", fontSize: "0.8rem", fontWeight: 500, lineHeight: 1.3 }
rounded: { r-card: 20px, r-row: 14px, r-chip: 12px, pill: 999px }
spacing: { tap: 44px, bar-h: 4.25rem, side-w: 15rem }
components:
  button: { backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0 1rem" }
  button-primary: { backgroundColor: "{colors.accent}", textColor: "{colors.on-accent}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0 1rem" }
  card: { backgroundColor: "{colors.card}", rounded: "{rounded.r-card}", padding: "1.15rem 1.25rem" }
  well: { backgroundColor: "{colors.sunk}", rounded: "{rounded.r-row}", padding: "0.9rem 1rem" }
  field: { backgroundColor: "{colors.sunk}", textColor: "{colors.ink}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0.55rem 0.8rem" }
  pill: { backgroundColor: "{colors.accent-soft}", textColor: "{colors.accent}", rounded: "{rounded.pill}", padding: "0.28rem 0.65rem" }
---
# Design System: Finances
Read before any visual change; update after the verified change. At most 150 lines: add a rule only if a future agent would otherwise err and no token or test enforces it.

## Overview
**Creative North Star: "Forest"** (redesign of 2026-11-17; the brief and direction contract are in `.impeccable/surfaces/frontend-src-app-tsx.md`).

Finances answers "what is free until payday?" with the hero figures and one pace line, and refuses the category's KPI tiles, donuts and rainbow categories. Its own world, independent of life-dashboard. Phone first (390 px), both themes always; only the tokens change between them.

**Key Characteristics:** sage-grey ground and white cards with a hairline by day, green-black by night; deep green (mint at night) marks what you can tap; the pace line is the signature, drawing in from payday onto a pill that says over or under pace.

## Colors
### Primary
- **Forest Green** (`accent`, label `on-accent`): what you can tap, the primary action, the current tab, links, focus. At night it is mint.
### Status (and nothing else)
- **Green** (`ok`, `accent-soft` behind): under plan, done, all sorted. **Amber** (`watch`, `watch-ink` for text and lines, `watch-soft` behind): watch, a little over, over pace, today. **Red** (`over`, `over-soft` behind): over plan, errors.
- **Series** (`series-needs`, `series-wants`, `series-savings`; other is `muted`): one colour per kind of spending on Trends.
### Neutral
- **Ground** (`bg`), **Card** (`card`, `raised`), **Sunk** (`sunk`: wells, tracks, the current choice), **Hairline** (`hair`, `rule`, `line`).
- **Ink and Text** (`ink`, `text`): figures, headings and controls; running text.
### Named Rules
- **The Status Rule.** A colour on Overview says a status or that something can be tapped. Never use amber, green or red for decoration or to tell categories apart. The pace line is green under pace and amber over it, the same colour as its pill.
- **The Quiet Rule.** `--muted` is only for graphic marks, the plan line and disabled controls. Small text uses `--quiet` (4.5:1 on white and on the ground, both themes), including the pace axis; a summary that opens something reads in `--text` or `--accent`.
- **The Series Rule.** The `--series-*` colours belong to Trends and are not status colours. Month's meters stay `--fill`.
- **The Old Names Rule.** `base.css` keeps the clay names (`--shu`, `--raise`, `--press`, `--gold`, `--moss` ...) as aliases so every page follows; their values are Forest's. New code uses the Forest names.

## Typography
**One family:** Geist (with system-ui), loaded in `index.html`; `--serif`, `--mono` and `--mincho` all point to it. Tabular figures everywhere.
### Hierarchy
- **Figure**: the hero amounts, weight 650, tracking -0.04em. The euro sign and the cents are smaller and lighter (`Amount`). One figure alone: 3.5rem on a phone, 4.5rem from 1024 px. The current month's pair: `clamp(2rem, 9vw, 2.75rem)`, 3.5rem from 1024 px, the two equal.
- **Heading**: card titles (`h2`), 0.95rem weight 600. The page's `h1` is the plan figure; headings inside a fold are `h2`, never a skipped level.
- **Label and Small**: above a figure (`.ov-label`), 0.95rem weight 500; notes, axis and sub-lines 0.8–0.875rem. Both `--quiet`, sentence case, never uppercase or tracked.

## Layout
A floating pill tab bar with the three places (Overview, Money, Plan) on a phone; from 1024 px a side rail with Find, Import, the places, Add and Dashboard. `1rem` is 15px here, so check touch sizes in pixels. Breakpoints: 380 px tightens, 720 px is phone against wider (tables, sheets, columns), 1024 px is the desktop shell, 1600 px uses the full width.
- **Overview order** (the brief): the figures, the pace line, Needs you, Still to pay, needs / wants / savings; then the folds (Every category) and the report link. From 1024 px Needs you and Still to pay stand beside the hero.
- **The Position Rule.** Phone tables and the Setup grid are position-based: each cell or section is placed by its number (`transactions.css`, `setup.css`, `import.css`). Adding, removing or moving one means changing the grid in the same edit; a target made 44 px with a negative block margin keeps the row's height, so never grow a phone row with padding. Details in the area docs.
### Areas
| id | Covers (routes) | Owns (files under frontend/src) |
| --- | --- | --- |
| shell | every route: side rail, tab bar, find, add, import | App.tsx, daylight.tsx, theme.ts, press.ts, components/shell/*, styles/shell.css, styles/press.css |
| month | `/` (Overview) | pages/Month.tsx, pages/month/*, pages/overview/*, styles/overview.css, styles/month.css |
| recurring | sheet opened from Month | components/recurring/*, styles/recurring.css |
| reports | `/report`, CSV chip, all transactions as CSV | components/reports/*, styles/reports.css |
| transactions | `/transactions` (Money: Payments) and review | pages/Transactions.tsx, pages/transactions/*, components/ReviewCard.tsx, AddTransactionModal.tsx, SplitModal.tsx, SplitEditor.tsx, CategorySelect.tsx, categorySelect/*, styles/transactions.css |
| merchants | sheet and view in Transactions | components/merchants/*, styles/merchants.css |
| trends | `/trends` (Money: Trends) | pages/Trends.tsx, pages/trends/*, styles/trends.css |
| goals | section on Trends | components/goals/*, styles/goals.css |
| setup | `/setup` (Plan) | pages/Setup.tsx, Rules.tsx, Settings.tsx, components/CategoryManager.tsx, SetAsides.tsx, TargetSplit.tsx, RuleSuggestions.tsx, BudgetPlanner.tsx, budget/*, pages/setup/*, styles/setup.css |
| import | `/import` | pages/Import.tsx, pages/import/*, styles/import.css |
| telegram | the bot's messages in the household's group | backend/telegram_bot.py (`render_*`), botkit.telegram (`rich`, `chunks`) |
| chat | the chat bubble on every page | chat/*, styles/chat.css |

Detail and special rules per area: `docs/design/<id>.md`. Shared (a change ripples, check every page): `styles/base.css`, `styles/controls.css`, `styles/tables.css`, `index.css`, `components/ErrorBanner.tsx`. Month uses CategorySelect too.

## Elevation & Depth
Flat and quiet. A card is white with a hairline and one soft shadow (`--raise`); a well or the current choice is the sunk tint with a hairline (`--press`). Sheets and popovers float with `--float-sheet`, `--float-pop` and the scrim.
- **The Spring Rule.** Everything you can press sinks at `--press-in` and comes back with a small spring at `--press-out`, tinting to `--press-tint`; `press.ts` holds a press at least 120 ms so a quick tap still shows it. Reduced motion turns it off.

## Shapes
`r-card` for cards and sheets, `r-row` for rows and wells, `r-chip` for buttons, fields and chips, full round for pills, icon buttons and the today dot. Meters are rounded bars.

## Components
### Buttons
- At least `--tap` tall; an icon button (`.btn-icon`) is 2.5rem round on a fine pointer and `--tap` on a coarse pointer or at 720 px and below.
- **Primary:** `accent` with `on-accent`, weight 600. One per view.
- **Disabled:** flat, `--muted`; an icon button that can't go further also fades to 0.4 so it never reads as the twin of its neighbour.
### Cards / Containers
- Cards are white `card` with a hairline. Never a card inside a card: inside a fold, the groups are sections split by a hairline (`.ov-fold .cat-group`).
- Folds that hide what the printed report needs stay in the DOM and are hidden by an `.is-open` class that print forces on; never `<details>` or conditional rendering there.
### Rows (Needs you)
- An icon in a soft status tile, two lines of text, a chevron when it links. Red rows are for an overrun worth acting on (at least €20 and a tenth of the plan, `figures.isMarked`), three at most; smaller overruns share one amber line, "N categories a little over".
### Inputs / Fields
- Sunk wells with chip radius at tap height; figures right-aligned and tabular. Focus is the accent ring and caret. Inputs are 16px on a coarse pointer so iOS doesn't zoom.
### Navigation
- Phone: the floating pill tab bar at the bottom, the current place filled with `accent`. Desktop: the side rail. Find, Add and Import live in the shell on every page. Dashboard is a house icon (labelled "Dashboard" on desktop), never a bare chevron.
### The Hero and the Pace Line
- The current month shows two figures side by side, equal: **Free in the plan** (the `h1`, with "About €X a day") and **Left in the account** ("After bills and saving"). "How this is worked out" holds one sum per figure, each ending on it, then the average day and "If it goes on". A past month shows one figure against its plan.
- Pace line: dashed `muted` plan, the spending line over a fading area, full width, 7.5rem tall on a phone rising to 10rem. A dot ends the spending line with a pill: "€X over pace" or "€X under pace", plus "by 16 Nov" when the bank files stop before today. Then today is a dashed `quiet` mark with its label at the foot; nothing is drawn for the days between.
- The plot is focusable: arrow keys, Home and End read a day (announced politely); hover or drag does the same.
- **The No Guessing Rule.** Every figure that projects or compares reads "Can't tell yet" instead of a guess. With status `gap` or `empty` Month says so ("Can't tell yet", "No bank files yet"), shows no meters or today tick, and offers the import as the one primary button.

## Do's and Don'ts
### Do:
- **Do** keep anything fixed or sticky at the bottom clear of the chat button: bottom at `--chat-fab-bottom` and one chat button short on the right wherever the content reaches it; from 721 to 1023 px it also sits above the tab bar.
- **Do** write plain words in British spelling, neutral about which of the two people is reading, and say spent with "more than planned". Name what a person does, not the tool ("They count once a category is picked", not "Claude wasn't sure"). Error text is the server's sentence alone, never "Server error 422:".
- **Do** make a sheet modal (`#root` inert, `html` overflow hidden, Tab wrapped, all restored before focus returns to the opener) and pin its header and buttons; a sticky header inside padding needs `top` equal to minus that padding.
- **Do** give a page's own transient line a persistent `role=status` region above the chat button; an Undo reverts only rows still as the action left them. A panel that appears below the fold scrolls to 1rem from the top and its heading takes focus.
- **Do** check both themes at 390 px and on a desktop.
### Don't:
- **Don't** add a literal colour, radius or shadow where a token exists.
- **Don't** bring back cream, an italic serif, mono or uppercase tracked labels, neon or glass; gradients only inside charts, fading to nothing. No KPI tile rows, donuts or "who spent it" on the Overview.
