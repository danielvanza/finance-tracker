---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

Scope: the whole Household Finance app, redesigned (new visual world, new organisation). Visitor mode: Operate.
Audience and job: both members of the household, one shared sign-in, phone first and desktop too, one of them not technical. They want to know in five seconds what is free to spend until payday, then act on what needs them.
Organisation: three places. Overview (the five blocks below), Money (every payment, search, review, month totals, trends), Plan (budget per category, set-asides, rules, settings). Import and the chat are actions reachable from everywhere, never pages, and never cover content on mobile.
Overview order: (1) free to spend until payday, per-day amount, days to payday; (2) pace line since payday; (3) Needs you: payments to sort, overspent categories, stale bank data; collapses to "All sorted" when empty; (4) still to pay before payday, bills and set-asides with dates; (5) needs / wants / savings planned vs spent, plus only the 1-3 categories near or over plan. Off the first screen: month totals, net worth, donuts, KPI tile rows, who spent it.
Evidence: research on Copilot, Monarch, YNAB, Emma, Monzo, bunq and others (board at .impeccable/mocks/research/index.html). Synthetic figures only.
Memorable moment: the pace line drawing in from payday to today and landing on a pill that says ahead or behind.
Unresolved: desktop layout of Overview (side rail vs top tabs); whether Trends keeps its own view inside Money.

## Direction contract

THESIS: Finances answers "what is free until payday?" with one hero number and one pace line, refusing the category's KPI tiles, donuts and rainbow categories; colour means status, nothing else.

OWN-WORLD: Forest. Day: sage-grey ground #EEF1EC, white cards with a hairline #DDE2DA, ink #1B2420, deep green #1F6F5C for what you tap. Night: green-black #111814, cards #1A231E, warm white ink, mint #7FD8A8. Status only: green under, amber #D9902B / #E8B04B watch and today, red over. Geist with tabular figures; cents and euro sign smaller and lighter. Gradients only inside charts, fading to nothing. No cream, italic serif, mono caps labels, neon or glass.

STORY: Opening shows what is free and whether that is ahead of plan; the line says how it got there; Needs you lists the few things to settle; still-to-pay explains why the number is lower than the bank balance. After a gap, Overview says it cannot tell yet, names the gap, and offers one action: import.

FIRST VIEWPORT: Top row with Finances and Import. "Free to spend until payday", €1.180 with small ,40, "About €196 a day · 6 days to payday". Full-width pace line, dashed ideal, area fade, today dot with a status pill. Needs you card with icon rows. Still to pay card. Floating pill tab bar Overview / Money / Plan at the bottom on phones; side rail on desktop.

FORM: Forest Light by day and Forest Night by night, grounded safer-register lineup after re-roll 1, chosen as G + H. seed:94c3f691d5e2eb80. Signature interaction: the hero number counts up and the pace line draws in from payday to today; dragging along the line shows what was free on any day; presses spring; emptying Needs you closes it into "All sorted".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
