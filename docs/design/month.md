# Month
- **Side stack.** Review, recurring and report rows live in one `.rep-links` column: 17rem beside the kinds panel from 1024 px, top-aligned with it, even gap. Add a row there, not as a new `.side-stack` child.
- **Order is frozen while a row is open.** Never re-sort categories under an open editor; they sort again on close and on a month change.
- **The end-of-month sentence** ("About €92 a day keeps you in plan…") shows only for status `ok`, the current month, after day 5, and replaces "Spent €X more than planned by now"; the fallback keeps that wording. It extrapolates from finished days only and never from a day with a payment of 10% or more of the plan.
- **"Paid"** on a row needs only status `ok`. **"Ahead"** follows the projection rules.
- **A month change keeps the last month dimmed** (`aria-busy`) under a stable month bar; never swap the page for a skeleton.
