# Design Discussion — FIN-E7: GitHub Actions CI workflow (kanban t_f31403bd)

Date: 2026-08-23
Scope guard: CI plumbing only. No application code is touched.

## Current State

- The repo has zero CI: no `.github/` directory exists at all.
- Both suites are verified green locally at commit deb70f9:
  - Backend: `python -m pytest backend/tests -q` → 194 passed.
  - Frontend: `npx vitest run` → 50 passed across 8 test files; `tsc -b` clean.
- Repo lives at `github.com/danielvanza/finance-tracker` (public), so Actions runs are
  free and run status is readable via the unauthenticated GitHub API.
- Backend packaging: `backend/pyproject.toml`, dev extras `[pytest, httpx, pytest-asyncio]`;
  installed editable from the repo root with `pip install -e "backend[dev]"`.
- Frontend: Vite + React 19 + TypeScript in `frontend/`;
  `scripts.build` = `tsc -b && vite build`; tests via `npx vitest run`.
- Nothing currently fails a push, a PR, or a bad merge — regressions surface only when a
  human remembers to run the suites locally.

## Desired End State

- CI guards `main`: every push to `main` and every pull request targeting `main` runs it.
- Two independent jobs that can fail separately:
  - `test-backend` — install backend with dev extras, run pytest.
  - `test-frontend` — clean `npm ci`, run vitest, then production build (`tsc -b`
    catches type drift that vitest misses).
- A single status badge sits at the top of README.md once the first run is green.
- Feature branches stay quiet day-to-day; noise starts only when a PR opens.

## Patterns to Follow

- First-party actions only, pinned to major versions:
  `actions/checkout@v4`, `actions/setup-python@v5`, `actions/setup-node@v4`.
- Caching comes from the setup actions' built-in options only
  (`cache: pip`, `cache: npm`) — no third-party cache action, no manual cache step.
- Explicit `cache-dependency-path` entries so pip caching keys off
  `backend/pyproject.toml` and npm caching keys off `frontend/package-lock.json`.
- No services, no containers, no matrix, no lint job, no deploy steps.

## Design Decisions (pre-answered by orchestrator)

1. **Triggers:** `on: push` filtered to branch `main`, plus `on: pull_request`
   targeting `main`. The branch filter keeps feature-branch pushes quiet until a PR
   is opened; PRs get full coverage before merge.
2. **Jobs:**
   - `test-backend`: ubuntu-latest, Python 3.11. Steps: checkout → setup-python
     (cache: pip) → `pip install -e "backend[dev]"` → `python -m pytest backend/tests -q`.
   - `test-frontend`: ubuntu-latest, Node 20. Steps: checkout → setup-node
     (cache: npm) → `npm ci` (working-directory: frontend) → `npx vitest run` →
     `npm run build`. The build step doubles as the type check (`tsc -b && vite build`),
     which catches type drift vitest alone would miss.
3. **Dependency-light:** only checkout@v4 + setup-python@v5 + setup-node@v4.
   No services, no containers, no matrix strategy — two flat jobs.
4. **Concurrency:** group `${{ github.workflow }}-${{ github.ref }}`,
   `cancel-in-progress: true` — superseded pushes to the same ref cancel their
   predecessors instead of queueing.
5. **timeout-minutes:** 15 per job. Both suites finish locally in well under 5 minutes;
   15 gives headroom for cold runners without letting a hung job burn an hour.
6. **Permissions:** workflow-level `contents: read` — least privilege; the workflow
   never needs write access to anything.
7. **Badge:** one line at the very top of README.md (directly under the
   `# Household Finance` H1), added only after the first green run.

## What We're NOT Doing

- No lint/format job (ruff/eslint) — separate ticket if wanted.
- No Dockerfile / docker-compose build job.
- No matrix builds across Python/Node versions — one pinned version each.
- No coverage measurement or upload (no Codecov etc.).
- No deployment steps, releases, or artifact publishing.
- No third-party actions beyond checkout and the two setup-* actions.
- No changes to application code, tests, or dependencies.

## Open Risks

- **pip editable install needs setuptools:** `backend/pyproject.toml` declares
  `[tool.setuptools] py-modules = []`. Editable installs of pyproject-only projects
  require setuptools present in the build env; modern GitHub runners ship pip recent
  enough to auto-fetch the build backend from `[build-system]`. If the install fails,
  add `setuptools` to the pip invocation — do not restructure packaging in this task.
- **npm ci requires a lockfile:** `frontend/package-lock.json` must be committed and in
  sync with package.json. Verified present; `npm ci` failing on drift would actually be
  a useful CI signal, not a false positive.
- **First-run flakiness:** network hiccups on pip/npm registry fetches can fail one-off;
  rerun before debugging anything real.
- **Badge timing:** adding the badge before the workflow's first successful run renders
  a "no status" image, hence the ordering: green run first, badge second.
