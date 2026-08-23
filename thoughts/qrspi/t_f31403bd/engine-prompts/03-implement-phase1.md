# qrspi Phase 7_implement — FIN-E7, Phase 1 only (kanban t_f31403bd)

You are executing the IMPLEMENT phase of the qrspi framework for this repo (/home/hermes/finance-tracker).
Your primary working document is thoughts/qrspi/t_f31403bd/plan.md — read it fully first.

## ABSOLUTE RULES
- Touch NOTHING outside /home/hermes/finance-tracker.
- Execute ONLY Phase 1 (CI workflow file). Phases 2 and 3 are orchestrator-controlled follow-ups — do NOT push, do NOT cherry-pick, do NOT touch README.md, do NOT create branches.
- Create exactly one new file: .github/workflows/ci.yml with the exact YAML content from plan.md Phase 1.
- Do not modify any application code, tests, or dependencies.
- End your reply with the literal line: PHASE1-COMPLETE

## Steps (from plan.md Phase 1)
1. Create .github/workflows/ci.yml with the exact YAML from plan.md (copy it verbatim).
2. Automated verification — run these literal commands and check outputs:
   - python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"  → exit 0, no output
   - cd backend && python -m pytest tests -q   → all pass (238 expected). MUST be run from backend/ (CWD-relative DATABASE_URL footgun documented in plan.md).
   - Frontend: use the ALREADY-INSTALLED node_modules — do NOT run npm ci locally (it wipes/reinstalls for nothing; npm ci correctness is exercised on CI runners). Run:
     - cd frontend && npx vitest run  → expect 50 passed across 8 files
     - cd frontend && npm run build   → exit 0 (tsc -b && vite build)
3. Update plan.md checkboxes for every item you actually executed and observed passing (automated section only; leave live-verification items unchecked — those happen later on GitHub).
4. Commit ONLY .github/workflows/ci.yml and the plan.md checkbox updates, as ONE commit on branch fin-v3-recurring-forecast:
   git add .github/workflows/ci.yml thoughts/qrspi/t_f31403bd/plan.md
   Message subject (≤72 chars): ci(workflows): add GitHub Actions CI (pytest + vitest + tsc build)
   Body bullet: two jobs on push/PR to main — backend pytest from backend/ cwd, frontend vitest + production build doubling as tsc type check.
   Do NOT push.
5. Report: print each verification command you ran with its key output lines (test counts), then PHASE1-COMPLETE.

## If something fails
- YAML parse fails or any suite goes red: fix ONLY if the cause is in ci.yml; if a pre-existing suite failure appears, STOP and report it verbatim instead of fixing application code.
- Never deviate from the YAML in plan.md to make things pass.
