#!/usr/bin/env bash
# Gate unit rung for t_f31403bd — mirrors CI job A (pytest from backend/).
set -euo pipefail
cd "$(dirname "$0")/../../.."
cd backend
V="$PWD/.venv"
"$V/bin/python" -m pytest tests -q
