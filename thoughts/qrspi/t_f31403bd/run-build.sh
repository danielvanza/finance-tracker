#!/usr/bin/env bash
# Gate integration rung for t_f31403bd — mirrors CI job B (clean type-check + production build).
set -euo pipefail
cd "$(dirname "$0")/../../.."
cd frontend
npm run build
