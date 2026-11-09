# Trends
- **Figures beside text** (amount and share, a delta) sit in wrapping flex rows with the text given at least 8rem; never fixed grid columns, which let the text go to zero at large text.
- **The chart is compact** when the plot is narrower than 14rem: no axis, no series names, three-letter months, leading empty months dropped. Sizes are decided in rem via `useRem`, not px or breakpoints.
- **Comparisons use finished months only**; with none to compare, say nothing (No Guessing Rule). "Kept" is income minus needs and wants, not the endpoint's `savings_rate_bps`.
- **The Savings goals section** is the last child of the second `.trends-col`.
