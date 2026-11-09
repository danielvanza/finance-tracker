---
name: Finances
description: Whether the household is on track this financial month, in life-dashboard's clay world
# Keys equal the CSS variables in frontend/src/styles/base.css; -night is the night theme. Shadow-recipe inputs (--hi, --lo, --line, --press-tint, --scrim) live only there. series-* are resolved from trends.css.
colors:
  shu: "#b54b35"
  shu-night: "#d8664a"
  on-shu: "#f8eee0"
  on-shu-night: "#2a1a12"
  gold: "#b08a4a"
  gold-night: "#d2ad6a"
  moss: "#6b7a5a"
  moss-night: "#9fb08a"
  error: "#9b2f1f"
  error-night: "#e0735a"
  series-needs: "oklch(0.538 0.102 238.4)"
  series-needs-night: "oklch(0.564 0.101 237.3)"
  series-wants: "oklch(0.616 0.123 75)"
  series-wants-night: "oklch(0.566 0.115 73.4)"
  series-savings: "oklch(0.458 0.112 148.4)"
  series-savings-night: "oklch(0.634 0.113 147.3)"
  bg: "#efe6d6"
  bg-night: "#2a2622"
  card: "#f4ecdd"
  card-night: "#2f2a26"
  raised: "#f8f1e5"
  raised-night: "#332e29"
  ink: "#2a2520"
  ink-night: "#efe5d3"
  text: "#4a433b"
  text-night: "#cfc4b2"
  quiet: "#6a6259"
  quiet-night: "#b1a797"
  muted: "#8c8378"
  muted-night: "#8f8576"
typography:
  display: { fontFamily: "Instrument Serif, Iowan Old Style, Georgia, serif", fontSize: "3.6rem", fontWeight: 400, lineHeight: 1, letterSpacing: "-0.01em" }
  headline: { fontFamily: "Instrument Serif, Iowan Old Style, Georgia, serif", fontSize: "2.6rem", fontWeight: 400, lineHeight: 1, letterSpacing: "-0.01em" }
  title: { fontFamily: "Instrument Serif, Iowan Old Style, Georgia, serif", fontSize: "1.45rem", fontWeight: 400, lineHeight: 1.2 }
  body: { fontFamily: "Zen Kaku Gothic New, system-ui, Segoe UI, sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
  section: { fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace", fontSize: "0.7rem", fontWeight: 400, lineHeight: 1.2, letterSpacing: "0.18em" }
  label: { fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace", fontSize: "0.68rem", fontWeight: 400, lineHeight: 1.2, letterSpacing: "0.14em" }
rounded: { r-card: 32px, r-row: 20px, r-chip: 14px }
spacing: { tap: 44px, bar-h: 3.5rem, side-w: 15rem, section: 2.2rem, block: 1.4rem, group: 1.1rem }
components:
  button: { backgroundColor: "{colors.raised}", textColor: "{colors.ink}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0 1rem" }
  button-primary: { backgroundColor: "{colors.shu}", textColor: "{colors.on-shu}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0 1rem" }
  panel: { backgroundColor: "{colors.card}", rounded: "{rounded.r-card}", padding: "1.15rem 1.25rem" }
  well: { backgroundColor: "{colors.bg}", rounded: "{rounded.r-row}", padding: "0.9rem 1rem" }
  field: { backgroundColor: "{colors.bg}", textColor: "{colors.ink}", rounded: "{rounded.r-chip}", height: "{spacing.tap}", padding: "0.55rem 0.8rem" }
  link-row: { backgroundColor: "{colors.raised}", textColor: "{colors.ink}", rounded: "{rounded.r-row}", height: "3rem", padding: "0 1.1rem" }
---
# Design System: Finances
Read before any visual change; update after the verified change. At most 150 lines: add a rule only if a future agent would otherwise err and no token or test enforces it.

## Overview
**Creative North Star: "One Line in Clay"**

Finances inherits life-dashboard's Clay x Japandi world instead of inventing its own, so the two apps read as one system. It answers "are we on track?" with one line, spending against plan across the financial month, and keeps everything else quiet. Phone first (390 px), both themes always; only the tokens change between them.

**Key Characteristics:**
- Washi by day, charcoal by night. Raised means you can press it or it holds things; pressed in means a well or the current choice.
- Serif italic headlines, gothic body, mono uppercase labels.
- The pace line is the signature: dashed plan, solid spending, today as the sun.

## Colors
Warm clay neutrals, one vermilion, a little gold and moss, and a validated set of data colours.
### Primary
- **Vermilion** (`shu`, label `on-shu`): the one thing that matters now.
### Secondary
- **Moon Gold** (`gold`): the hollow today mark at night; by day the hollow mark uses `quiet`, because gold falls under 3:1 there. **Moss** (`moss`): done and saved. **Oxide Red** (`error`): errors only.
- **Series** (`series-needs`, `series-wants`, `series-savings`; other is `muted`): one colour per kind of spending on Trends.
### Neutral
- **Washi and Charcoal** (`bg`): the page and every well. **Panel and Raised Clay** (`card`, `raised`): panels; rows and chips.
- **Ink and Text** (`ink`, `text`): headings, figures and controls; running text.
- **Quiet** (`quiet`): small sans text. **Muted** (`muted`): mono labels and graphic marks.
- **Meter Parts** (`--fill`, 3:1 against the well; `--tick`, ink): a meter's fill and where today falls.
### Named Rules
- **The Upstream Rule.** Tokens in `base.css` are copied from `life-dashboard/frontend/src/styles/base.css` on purpose and life-dashboard's DESIGN.md is their authority: change a token in life-dashboard first, then here. Finance's own additions are only `--quiet`, `--fill`, `--tick`, `--tap` and the `--series-*` colours. Copied tokens finance doesn't use yet stay as copied.
- **The One Vermilion Rule.** One vermilion mark per view: the sun or the primary action. When a later step's action appears, the earlier button goes plain. The current-tab underline, focus ring, caret and link hover are wayfinding and don't count.
- **The Quiet Rule.** `--muted` is only for mono labels, graphic marks and disabled controls. Small sans text uses `--quiet` (4.5:1 on every surface, both themes).
- **The Series Rule.** The `--series-*` colours are derived in `trends.css` and validated for colour-blind separation on the card in both themes. They are not free choices: re-run the validator before changing one. They belong to Trends; Month's meters stay `--fill`.

## Typography
**Display Font:** Instrument Serif (with Iowan Old Style, Georgia). **Body Font:** Zen Kaku Gothic New (with system-ui, Segoe UI). **Label/Mono Font:** JetBrains Mono (with ui-monospace, Consolas).

**Character:** A soft italic serif speaks the answer; a typewriter mono labels everything around it.
### Hierarchy
- **Display** (italic): Month's verdict only. `clamp(3rem, 15vw, 3.6rem)` on a phone, 5rem from 1024 px; 2.4rem and 3.4rem when it says it can't tell.
- **Headline** (italic): page titles, 3.4rem from 1024 px. **Title** (upright): the finding above a Trends chart.
- **Body**: running text; figures in lists use tabular numbers.
- **Section / Label** (uppercase): section headings and field or period labels. Tabs go down to 0.6rem on a phone.
- **The Typewriter Rule.** Never change the mono labels' font or greys; life-dashboard holds that decision.

## Layout
A slim clay top row, the page, and a fixed tab slab on a phone; from 1024 px a sticky raised side panel beside the page. Content padding is 1.1rem on a phone and 2.4rem 3.5rem on a desktop, capped at 92rem until 1600 px. `1rem` is 15px here, so check touch sizes in pixels. Breakpoints: 380 px tightens, 720 px is phone against wider (tables, sheets), 1024 px is the desktop shell, 1600 px uses the full width.

- **The Position Rule.** Phone tables are position-based: each cell is placed by its column number (`transactions.css`, `setup.css`, `import.css`). Adding, removing or moving a column means changing the phone grid in the same edit, or the cells land in the wrong places.
### Areas
| id | Covers (routes) | Owns (files under frontend/src) |
| --- | --- | --- |
| shell | every route: top row, side panel, tabs, theme, press | App.tsx, daylight.tsx, theme.ts, press.ts, styles/shell.css, styles/press.css |
| month | `/` | pages/Month.tsx, pages/month/*, styles/month.css |
| transactions | `/transactions` and review | pages/Transactions.tsx, pages/transactions/*, components/ReviewCard.tsx, AddTransactionModal.tsx, SplitModal.tsx, SplitEditor.tsx, CategorySelect.tsx, categorySelect/*, styles/transactions.css |
| trends | `/trends` | pages/Trends.tsx, styles/trends.css |
| setup | `/setup` | pages/Setup.tsx, Rules.tsx, Settings.tsx, components/CategoryManager.tsx, StandingAdjustments.tsx, styles/setup.css |
| import | `/import` | pages/Import.tsx, styles/import.css |

Shared (a change ripples, check every page): `styles/base.css`, `styles/controls.css`, `styles/tables.css`, `index.css`, `components/ErrorBanner.tsx`. Month uses CategorySelect too. Not covered: `chat/` and `styles/chat.css`, built separately.

## Elevation & Depth
Clay is the only depth. Raised surfaces use `--raise`, `--raise-sm` and `--raise-lg`; wells and current choices use `--press-sm`, held fingers `--press-held`. Sheets and popovers float with `--float-sheet`, `--float-pop` and the scrim. `--bead` is only for the sun.
- **The Soft Clay Rule.** Everything you can press sinks at `--press-in` and puffs back at `--press-out`, darkening to `--press-tint`; `press.ts` holds a press at least 120 ms so a quick tap still shows it. Reduced motion turns it off.

## Shapes
Three radii: `r-card` for panels and sheets, `r-row` for rows and wells, `r-chip` for buttons, fields and chips. Meters are rounded bars; today's dot is a circle.

## Components
### Buttons
- **Shape:** chip radius, at least `--tap` tall; the small size (2.25rem) grows to `--tap` for a coarse pointer or at 720 px and below.
- **Primary:** vermilion with its `on-shu` label, weight 700.
- **Hover / Focus:** lifts 1 px on hover devices; 2px vermilion focus ring, 3px offset; press sinks and scales to 0.975.
- **Quiet / Disabled:** a row's remove action is `--quiet` until hover or press, then `--error`. Disabled is flat: a hairline and `--muted`.
- **Segmented choice:** a row of raised chips; the chosen one is pressed in, ink, weight 700.
### Cards / Containers
- Panels are raised `card`; wells are pressed-in `bg`. Hairlines (`--line`) separate rows inside a panel, never around it.
### Inputs / Fields
- Pressed-in wells with chip radius at tap height; figures right-aligned and tabular. Focus is the vermilion ring and caret. Inputs are 16px on a coarse pointer so iOS doesn't zoom.
### Navigation
- Phone: four raised chips in the slab, mono labels. Desktop: raised rows in the side panel. The current tab is pressed in with an ink label and vermilion underline; one well glides between tabs (0.28 s). A raised chip goes back to the dashboard.
### Meters and the Pace Line
- Meter: a pressed-in track with a `--fill` bar and an ink tick where today falls; no tick when the month isn't known.
- Pace line: dashed `muted` plan, solid `ink` spending, full width, 6.5rem tall on a phone rising to 11rem. Hover or drag shows the day, spent and plan by then.
- **The Sun and Moon Rule.** Today's dot is a raised vermilion sun by day and a hollow gold moon by night, and hollow in both themes whenever spending doesn't reach today.
- **The No Guessing Rule.** Month never guesses after a gap. With status `gap` or `empty` it says so ("Can't tell yet", "No bank files yet"), shows no meters or today tick, folds the plan away, and offers the import as the one vermilion button.

## Do's and Don'ts
### Do:
- **Do** take the current financial month from the pace endpoint's `current_month`, never the calendar.
- **Do** use plain CSS classes in `src/styles/`, with inline `style` only for computed values such as a width or position.
- **Do** write plain words in British spelling, neutral about which of the two people is reading.
- **Do** say spent with "more than planned", always: "Spent €133 more than planned by now."
- **Do** check both themes at 390 px and on a desktop.
### Don't:
- **Don't** add a literal colour, radius or shadow where a token exists.
- **Don't** make a flat bordered box; only a disabled chip is flat, with a hairline.
- **Don't** add indigo, glass, or decorative gradients and glows; the night lamplight behind the page is inherited and the only one.
