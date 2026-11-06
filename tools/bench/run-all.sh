#!/usr/bin/env bash
# Reproduce docs/benchmarks (see docs/benchmarks/README.md). Collectors need network; bench-b1 runs offline from data/.
set -euo pipefail
cd "$(dirname "$0")/../../packages/guard"
TSX=../../node_modules/.bin/tsx
if [[ "${1:-}" != "--offline" ]]; then
  $TSX bench/collect-drainers.ts 150
  $TSX bench/collect-benign.ts
  $TSX bench/collect-ptxphish.ts 120
  $TSX bench/bench-b2.ts
  node ../../apps/extension/scripts/build.mjs >/dev/null   # B3 runs the built content script
  $TSX bench/bench-b3.ts
fi
$TSX bench/bench-b1.ts
cd ../.. && pnpm vitest run packages/guard
