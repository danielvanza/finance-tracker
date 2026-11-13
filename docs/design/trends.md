# Trends
- **Figures beside text** (amount and share, a delta) sit in wrapping flex rows with the text given at least 8rem; never fixed grid columns, which let the text go to zero at large text.
- **The chart is compact** when the plot is narrower than 14rem: no axis, no series names, three-letter months, leading empty months dropped. Sizes are decided in rem via `useRem`, not px or breakpoints.
- **The chart's right margin is 56px only while a series name is drawn beside the latest column** (some segment 12px or taller), 8px otherwise, so the grid reaches the panel text edge; `SpendingChart` reads what the chart drew.
- **Tooltip rows are a grid** (swatch, name, right-aligned amount); the total row has no swatch and its name is indented to line up. Markup stays amount-then-name, ordered by CSS.
- **The Figures table is flush**: first column no left padding, last no right padding, so text meets the hairlines and panel edge.
- **Comparisons use finished months only**; with none to compare, say nothing (No Guessing Rule). "Kept" is income minus needs and wants, not the endpoint's `savings_rate_bps`.
- **The Savings goals section** is the last child of the second `.trends-col`.
