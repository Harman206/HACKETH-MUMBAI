#!/usr/bin/env bash
# One command for demo day: (re)starts everything the Copeybara demo needs on the default ports.
#   scripts/demo-start.sh          → portal http://localhost:8090, DemoSwap http://demoswap.localhost:8080,
#                                     look-alike http://demoswap-rewards.localhost:8082, kit http://localhost:8000,
#                                     watcher status http://127.0.0.1:8095
#   scripts/demo-start.sh stop     → stops them
# Logs: .demo/harness.log, .demo/watcher.log. Needs contracts/.env (DEPLOYER_KEY, ATTACKER_KEY, WATCHER_KEY).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .demo
PORTS="8000 8080 8081 8082 8090 8095 8645"

stop() {
  for p in $PORTS; do
    pids=$(lsof -ti tcp:"$p" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  sleep 1
}

stop
[ "${1:-}" = "stop" ] && { echo "demo stopped"; exit 0; }

# Build what the demo serves (kit + extension) so the bytes match the ENS records.
SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build >/dev/null 2>&1
node apps/extension/scripts/build.mjs >/dev/null 2>&1

nohup pnpm --filter @copeybara/harness start > .demo/harness.log 2>&1 &
nohup scripts/watcher-live.sh > .demo/watcher.log 2>&1 &

for i in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:8090/ && break
  sleep 1
done
curl -s -o /dev/null -w "portal   http://localhost:8090  (%{http_code})\n" http://127.0.0.1:8090/ || echo "portal not up: see .demo/harness.log"
curl -s -o /dev/null -w "DemoSwap http://demoswap.localhost:8080  (%{http_code})\n" http://127.0.0.1:8080/ || true
echo "watcher  http://127.0.0.1:8095  (first check within ~15 s; log .demo/watcher.log)"
echo "Open the portal and follow the Guided demo."
