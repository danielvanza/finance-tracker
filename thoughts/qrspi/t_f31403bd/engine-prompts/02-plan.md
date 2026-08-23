# qrspi Phase 5_plan — FIN-E7 CI workflow (kanban t_f31403bd)

You are executing the PLAN phase of the qrspi framework for this repo (/home/hermes/finance-tracker).

## ABSOLUTE RULES
- Touch NOTHING outside /home/hermes/finance-tracker. Every spec you need is inlined below — do NOT try to read ~/.claude or any other external path.
- This phase writes EXACTLY ONE file: thoughts/qrspi/t_f31403bd/plan.md. You MUST write that file before ending your turn. No other file may be created or modified.
- Do not implement anything. Plan only.
- End your reply with the literal line: PLAN-WRITTEN

## Inputs (read these, fully)
- thoughts/qrspi/t_f31403bd/design.md   ← approved design; follow it exactly
- backend/pyproject.toml                ← packaging + dev extras
- frontend/package.json                 ← scripts.build = "tsc -b && vite build"; vitest via npx
- README.md                             ← H1 "# Household Finance" on line 1 (badge anchor, NOT edited this task)

## Hard constraints (from the orchestrator)
1. The plan covers two deliverable commits:
   - Commit A: .github/workflows/ci.yml (the whole CI workflow) — on branch fin-v3-recurring-forecast
   - Commit B: one badge line in README.md — ONLY as a documented follow-up executed on main AFTER the first green CI run. NOT part of the branch work.
2. Backend job MUST run pytest from working-directory: backend (command: python -m pytest tests -q). Rationale: db.py resolves default DATABASE_URL CWD-relatively ("sqlite:///./data/finance.db"); running pytest from repo root is a known footgun. pip install -e "backend[dev]" still runs from repo ROOT (correct and verified).
3. Frontend job: working-directory frontend; steps npm ci → npx vitest run → npm run build (build doubles as tsc type check).
4. Triggers: push to main + pull_request targeting main. Concurrency group ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true. Workflow-level permissions: contents: read. timeout-minutes: 15 per job.
5. Actions pinned to majors only: actions/checkout@v4, actions/setup-python@v5 (cache: pip, cache-dependency-path: backend/pyproject.toml), actions/setup-node@v4 (node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json). Nothing else. No services, no matrix, no containers.
6. Known accepted risk (design.md): backend pyproject has no [build-system]; modern pip auto-fetches setuptools backend. Do not restructure packaging.

## plan.md template (follow exactly)

# Implementation Plan

## Overview
[1-2 sentences from the design's desired end state]

## Phase 1: CI workflow file
### Changes
#### 1. .github/workflows/ci.yml
**File**: .github/workflows/ci.yml
**Action**: create
```yaml
[the complete workflow YAML — full content, not a sketch]
```
### Verification
#### Automated
- [ ] python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" → exit 0
- [ ] cd backend && python -m pytest tests -q → all pass (238 expected)
- [ ] cd frontend && npm ci && npx vitest run → 50 passed across 8 files; npm run build → exit 0
#### Live Verification (agent executes and reports back)
- [ ] Push branch fin-v3-recurring-forecast to origin → git push succeeds
- [ ] Cherry-pick the ci.yml commit onto local main and push → commit lands on origin/main
- [ ] Poll https://api.github.com/repos/danielvanza/finance-tracker/actions/runs?per_page=5 (unauthenticated GET with User-Agent header) until both jobs conclude → conclusion == "success" for test-backend AND test-frontend
#### Manual (human spot-check — keep short)
- [ ] Badge visible at top of README on GitHub once added

## Phase 2: first green run on GitHub (push choreography only — no file changes beyond Phase 1)
[Describe exactly: push branch → cherry-pick Commit A onto local main → push main → poll runs API → record run id/URLs]
### Verification
#### Automated
- [ ] Both jobs green (conclusion "success") on the main-push run
#### Live Verification
- [ ] curl-equivalent poll shows run status completed / conclusion success
#### Manual
- [ ] None

## Phase 3: badge on main (AFTER green run only)
### Changes
#### 1. README.md badge line
**File**: README.md (on main)
**Action**: modify — insert directly under the "# Household Finance" H1:
```markdown
[![CI](https://github.com/danielvanza/finance-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/danielvanza/finance-tracker/actions/workflows/ci.yml)
```
### Verification
#### Automated
- [ ] Badge URL returns HTTP 200 after push
#### Live Verification
- [ ] Rendered README on GitHub shows the badge with passing status
#### Manual
- [ ] None

## Output
Write thoughts/qrspi/t_f31403bd/plan.md now (complete YAML inside), print a ≤10-line summary, end with PLAN-WRITTEN.
