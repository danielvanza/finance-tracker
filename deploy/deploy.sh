#!/usr/bin/env bash
# Builds this checkout's HEAD into a new release and switches the service to it; if it doesn't come
# up healthy, switches back. The database lives outside the releases, so a deploy can't touch it.
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
root=$HOME/apps/household-finance
sha=$(git -C "$repo" rev-parse --short HEAD)
release=$root/releases/$sha
previous=$(readlink "$root/current" 2>/dev/null || true)

rm -rf "$release"
mkdir -p "$release" "$HOME/.local/share/household-finance"
chmod 700 "$HOME/.local/share/household-finance"
git -C "$repo" archive HEAD | tar -x -C "$release"

(cd "$release/backend" && uv venv -q .venv && uv pip install -q -p .venv/bin/python .)
(cd "$release/frontend" && npm ci --silent && FINANCES_BASE=/finances/ npm run build)

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -m 2 http://127.0.0.1:18600/api/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

ln -sfn "$release" "$root/current"
systemctl --user restart household-finance
if healthy; then
  if systemctl --user is-enabled -q household-finance-telegram 2>/dev/null; then
    systemctl --user restart household-finance-telegram
  fi
  echo "deployed $sha"
  exit 0
fi
echo "release $sha did not come up healthy" >&2
if [ -n "$previous" ]; then
  ln -sfn "$previous" "$root/current"
  systemctl --user restart household-finance
  echo "rolled back to $(basename "$previous")" >&2
fi
exit 1
