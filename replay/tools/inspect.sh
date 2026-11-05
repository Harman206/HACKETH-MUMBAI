#!/usr/bin/env bash
# Inspect a replay transaction with an archive RPC: decoded input + a local trace.
#   replay/tools/inspect.sh <txhash> [rpc]
set -euo pipefail
H=${1:?tx hash}; RPC=${2:-${ARCHIVE_RPC:-https://gateway.tenderly.co/public/mainnet}}
CAST=$(command -v cast || echo "$HOME/.foundry/bin/cast")
"$CAST" tx "$H" --rpc-url "$RPC"
echo "--- input"; "$CAST" tx "$H" input --rpc-url "$RPC"
echo "--- trace"; "$CAST" run "$H" --rpc-url "$RPC" --quick 2>&1 | tail -40
