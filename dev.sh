#!/usr/bin/env bash
#
# dev.sh — one command to run Household Finance locally.
#
# Bootstraps the backend virtualenv + deps and the frontend node_modules on
# first run (or when they're missing), then starts both dev servers together
# and shuts them down cleanly on Ctrl+C.
#
#   ./dev.sh          # setup (if needed) + run backend + frontend
#   ./dev.sh setup    # only install/refresh dependencies, don't run
#
# Backend:  http://localhost:8000   (FastAPI, auto-reload)
# Frontend: http://localhost:5173   (Vite, proxies /api -> :8000)

set -euo pipefail
# Monitor mode: each background job (below) runs in its own process group, so we
# can signal the whole tree — uvicorn's reload worker, npm's Vite child — at once.
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$BACKEND/.venv"

# --- pretty logging ----------------------------------------------------------
c_reset=$'\033[0m'; c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'
info()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()    { printf '%s==>%s %s\n' "$c_green"  "$c_reset" "$*"; }
warn()  { printf '%s==>%s %s\n' "$c_yellow" "$c_reset" "$*"; }

# --- prerequisite checks -----------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }
need python3
need node
need npm

# --- backend setup -----------------------------------------------------------
setup_backend() {
  if [ ! -d "$VENV" ]; then
    info "Creating backend virtualenv (.venv)…"
    python3 -m venv "$VENV"
  fi
  # Install deps only when the venv is fresh or pyproject changed since last install.
  local stamp="$VENV/.deps-stamp"
  if [ ! -f "$stamp" ] || [ "$BACKEND/pyproject.toml" -nt "$stamp" ]; then
    info "Installing backend dependencies…"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
    (cd "$BACKEND" && "$VENV/bin/pip" install --quiet -e ".[dev]")
    touch "$stamp"
    ok "Backend dependencies ready."
  else
    ok "Backend dependencies up to date."
  fi
}

# --- frontend setup ----------------------------------------------------------
setup_frontend() {
  if [ ! -d "$FRONTEND/node_modules" ] || [ "$FRONTEND/package-lock.json" -nt "$FRONTEND/node_modules" ]; then
    info "Installing frontend dependencies (npm install)…"
    (cd "$FRONTEND" && npm install --silent)
    ok "Frontend dependencies ready."
  else
    ok "Frontend dependencies up to date."
  fi
}

setup_backend
setup_frontend

if [ "${1:-}" = "setup" ]; then
  ok "Setup complete. Run ./dev.sh to start the app."
  exit 0
fi

# --- run both servers --------------------------------------------------------
pids=()

# Recursively terminate a process and all its descendants. uvicorn --reload
# spawns a worker child and npm spawns the Vite process, so killing only the
# top pid would orphan them on ports 8000/5173. Depth-first: children first.
kill_tree() {
  local pid=$1
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleaned=0
cleanup() {
  [ "$cleaned" = 1 ] && return; cleaned=1
  warn "Shutting down…"
  for pid in "${pids[@]}"; do
    kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

info "Starting backend  → http://localhost:8000"
(cd "$BACKEND" && exec "$VENV/bin/uvicorn" main:app --reload --port 8000) &
pids+=($!)

info "Starting frontend → http://localhost:5173"
(cd "$FRONTEND" && exec npm run dev) &
pids+=($!)

ok "Both servers running. Open http://localhost:5173  (Ctrl+C to stop)"

# Wait for either process to exit; cleanup trap stops the other.
wait -n
