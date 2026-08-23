# Implementation Plan

## Overview

CI guards `main`: every push to `main` and every pull request targeting `main` runs two independent jobs — `test-backend` (pytest) and `test-frontend` (vitest + production build doubling as the `tsc -b` type check) — and a single status badge sits at the top of README.md once the first run is green.

## Phase 1: CI workflow file
### Changes
#### 1. .github/workflows/ci.yml
**File**: .github/workflows/ci.yml
**Action**: create
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-backend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: pip
          cache-dependency-path: backend/pyproject.toml
      - name: Install backend with dev extras
        run: pip install -e "backend[dev]"
      - name: Run backend tests
        working-directory: backend
        run: python -m pytest tests -q

  test-frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Run frontend tests
        run: npx vitest run
      - name: Build (tsc type check + vite build)
        run: npm run build
```
### Verification
#### Automated
- [x] python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" → exit 0
- [x] cd backend && python -m pytest tests -q → all pass (238 expected)
- [x] cd frontend && npm ci && npx vitest run → 50 passed across 8 files; npm run build → exit 0
  (executed locally per orchestrator override: skipped `npm ci`, used existing node_modules; result 52 passed / 8 files, build exit 0)
#### Live Verification (agent executes and reports back)
- [ ] Push branch fin-v3-recurring-forecast to origin → git push succeeds
- [ ] Cherry-pick the ci.yml commit onto local main and push → commit lands on origin/main
- [ ] Poll https://api.github.com/repos/danielvanza/finance-tracker/actions/runs?per_page=5 (unauthenticated GET with User-Agent header) until both jobs conclude → conclusion == "success" for test-backend AND test-frontend
#### Manual (human spot-check — keep short)
- [ ] Badge visible at top of README on GitHub once added

## Phase 2: first green run on GitHub (push choreography only — no file changes beyond Phase 1)

Choreography, in exact order:

1. **Commit A on the branch.** With `.github/workflows/ci.yml` created per Phase 1, commit it on branch `fin-v3-recurring-forecast` with a message like `ci: add GitHub Actions workflow (backend pytest + frontend vitest/build)` and `git push -u origin fin-v3-recurring-forecast`. This push alone triggers NO run — the trigger is filtered to `main`.
2. **Cherry-pick Commit A onto local main.** `git checkout main && git pull --ff-only origin main`, then `git cherry-pick <Commit-A-sha>` (no conflicts possible: the commit only adds a new file), then `git push origin main`. This push to `main` fires the first CI run.
3. **Poll the runs API.** Unauthenticated GET with a `User-Agent` header against `https://api.github.com/repos/danielvanza/finance-tracker/actions/runs?per_page=5`; poll until the newest run with `head_branch == "main"` reports `status == "completed"`, then check both jobs.
4. **Record results.** Note the run `id`, `html_url`, each job's name (`test-backend`, `test-frontend`) and its `conclusion` in this ticket's notes.

If either job fails: rerun once (first-run flakiness risk from design.md); if it fails again, debug from the run logs before touching anything else. Do NOT add the badge until both jobs are green on the main-push run.
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
