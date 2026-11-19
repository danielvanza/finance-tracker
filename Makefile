# make check: everything that must pass before a change is merged.
.PHONY: check
check:
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm run lint
	cd frontend && npm run build
	cd frontend && npx vitest run --testTimeout=30000
