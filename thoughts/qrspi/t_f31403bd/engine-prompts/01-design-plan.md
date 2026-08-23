You are the qrspi engine for finance-tracker (FastAPI backend + React/Vite frontend). Work in /home/hermes/finance-tracker. This is a SMALL, well-scoped task: add a GitHub Actions CI workflow (.github/workflows/ci.yml). Do NOT touch application code.

TASK CONTEXT (kanban t_f31403bd, FIN-E7):
- Repo has zero CI: no .github/workflows/. Public repo github.com/danielvanza/finance-tracker.
- Suites verified green at deb70f9: backend pytest 194 passed; frontend vitest 50 passed / 8 files, tsc -b clean.
- Backend: pyproject.toml at backend/, extras dev = [pytest, httpx, pytest-asyncio]. Install: pip install -e "backend[dev]" from repo root.
- Frontend: package.json at frontend/. Scripts: "build" = "tsc -b && vite build". Vitest run via: npx vitest run.

You cannot read files outside /home/hermes/finance-tracker; everything you need is inline below and in the repo.

QRSPI PHASE GISTS YOU ARE EXECUTING (adapted for headless mode — design questions are pre-answered by the orchestrator; do NOT ask questions):

--- qrspi 3_design gist ---
Write ~100-line thoughts/qrspi/t_f31403bd/design.md with sections:
# Design Discussion
## Current State — what exists today (no .github/, suites green locally at deb70f9, repo public on GitHub)
## Desired End State — CI guards main on every push and PR; two jobs; badge in README
## Patterns to Follow — actions/checkout@v4, setup-python/setup-node built-in caching only; no services, no containers, no third-party actions beyond setup-* and checkout
## Design Decisions (pre-answered):
1. Triggers: on push to main AND pull_request targeting main. Branch filter keeps feature branches quiet until PR opens.
2. Jobs: test-backend (ubuntu-latest, python 3.11) runs: pip install -e "backend[dev]", then python -m pytest backend/tests -q. test-frontend (ubuntu-latest, node 20) runs npm ci in frontend/, then npx vitest run, then npm run build (tsc catches type drift vitest misses).
3. Dependency-light: only actions/checkout@v4 + setup-python@v5 (cache: pip) + setup-node@v4 (cache: npm). No services, no containers, no matrix.
4. concurrency: group ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress true — cancels superseded pushes.
5. timeout-minutes: 15 per job.
6. permissions: contents: read at workflow level.
7. Badge: one line at top of README.md once first run is green.
## What We're NOT Doing — no lint job, no Dockerfile/compose, no matrix builds, no coverage upload, no deploy steps
## Open Risks — pip editable install needs setuptools (pyproject has [tool.setuptools] py-modules=[]); npm ci requires package-lock.json present in frontend/
--- end gist ---

--- qrspi 5_plan gist ---
Write thoughts/qrspi/t_f31403bd/plan.md as a self-contained checkbox plan:
# Implementation Plan
## Overview
## Phase 1: Workflow file
### Changes — File: .github/workflows/ci.yml, Action: create. Include the full YAML content in the plan.
### Verification — Automated checkboxes: yaml parses (python3 -c "import yaml,yaml.safe_load..."), backend suite rerun, frontend suite rerun + build.
#### Live Verification (literal commands): cd /home/hermes/finance-tracker && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" → exits 0 silently. python3 -m pytest backend/tests -q → 194 passed. cd frontend && npx vitest run → 8 files 50 tests passed. cd frontend && npm run build → exit 0, dist/ produced.
#### Manual spot-check: human reads ci.yml diff on GitHub and sees first Actions run green.
## Phase 2: README badge
### Changes — File: README.md, Action: modify (one line under the title).
### Verification — markdown renders; badge URL points to .github/workflows/ci.yml.
## Phase 3: Push + watch first run
### Changes — commit on fin-v3-recurring-forecast, push branch, fast-forward main, push main.
### Verification — poll https://api.github.com/repos/danielvanza/finance-tracker/actions/runs?per_page=1 until latest run conclusion == success (curl, public API, jq available).
--- end gist ---

EXECUTE NOW:
1. Write both files exactly per the gists above. Do NOT create .github/workflows/ci.yml yet. Do NOT touch README yet.
2. Report when done.
