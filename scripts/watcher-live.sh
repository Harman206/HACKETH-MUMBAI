#!/usr/bin/env bash
# Run the Copeybara watcher against the live Sepolia name (booth demo). Needs WATCHER_KEY in contracts/.env.
#   scripts/watcher-live.sh        → status JSON on http://127.0.0.1:8095/
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . contracts/.env; set +a
export WATCH_NAMES=${WATCH_NAMES:-demoswap-blackout.eth}
export CANDIDATES=${CANDIDATES:-"demoswap-blackout.eth=http://demoswap-rewards.localhost:8082/"}
export STATUS_PORT=${STATUS_PORT:-8095} INTERVAL_MS=${INTERVAL_MS:-15000}
exec pnpm --filter @copeybara/watcher start
