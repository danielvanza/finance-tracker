---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

Scope: the whole Household Finance app (shell plus Month, Transactions, Trends, Setup, Import). Visitor mode: Operate.
Audience and job: both members of the household, under one shared sign-in, on phone and desktop. They want to know whether the month is on track, and to restart a lapsed routine of importing and reviewing.
Constraints: sibling of life-dashboard at /finances with its own deploy; world is life-dashboard's Clay x Japandi, inherited, not reinvented. Backend gets small additions only.
Memorable moment: the month drawn as one line with today as the sun.
Unresolved: whether import-due reminders exist at all.

## Direction contract

THESIS: Finances answers "are we on track?" with one line, spending against plan across the financial month, instead of the category-default row of KPI tiles above a donut.

OWN-WORLD: Life-dashboard's tokens unchanged: washi by day, charcoal by night, raised and pressed clay surfaces, Instrument Serif italic headlines, Zen Kaku Gothic body, JetBrains Mono uppercase labels, vermilion once per view. No indigo, glass, gradients or glows.

STORY: Opening it shows what's left and whether that is ahead of plan. They see which of needs, wants, savings is running ahead, then act on what's waiting. After a gap it says it can't tell yet, names the gap, and offers one action: bring in bank files.

FIRST VIEWPORT: Slim clay top row with Finances and a way back to the dashboard. Mono period label. "€1,725 left" as the serif headline, one plain sentence of pace under it. Pace chart full width: dashed plan line, solid spending line, vermilion sun at today. Raised card of needs, wants, savings meters each with a today tick, furthest ahead first. Review count link. Clay tab slab at the bottom on phones (Month, Transactions, Trends, Setup), raised side panel on desktop. The primary action in the gap state is the vermilion button.

FORM: Pace line, first of the three presented structures. seed:a344d8fa113e8c3e. Signature interaction: the pace line, whose today dot is a sun by day and hollow gold moon by night; press feedback matches life-dashboard's soft clay.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
