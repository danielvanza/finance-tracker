# Savings goals
- A goal's meter fills to saved of target. The tick is where an even path from the start amount to the target month would be today; no date, no tick.
- Pace comes from the last three finished months with bank data and needs two; fewer says "Can't tell yet" and shows no pace (No Guessing Rule).
- At most 5 goals, one per savings category, stored as JSON in the `savings_goals` setting; progress counts savings spend since the goal's start date.
- **The goals panel keeps the panel inset**: top padding 0.35rem (each row adds 0.8rem, so the first line sits 1.15rem down) and bottom 1.15rem under the Add a goal button.
