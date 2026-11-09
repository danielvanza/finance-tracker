# Import
- **Position Rule.** The preview's amount and status cells are `nowrap` (the minus sign must not wrap); the catch-up path uses `--steps` columns from 900 px.
- **The result replaces the steps** after confirm, focus moves to its heading, and `['pace']` is invalidated so freshness and Month are current.
- **The catch-up path** shows only from a snapshot taken when the page opens: a bank at least `CATCHUP_DAYS` (7) behind `pace.today`, or status `gap` or `empty`. Words give dates and "N days ago", never counts of missed days, streaks or red.
- **The preselected bank** is the one with the oldest last row among those with a file; DEGIRO without a file is never preselected.
