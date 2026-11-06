#!/usr/bin/env bash
# Live revocation demo: the 2-of-3 Safe takes the watcher agent's ENS write roles away, or gives them back.
#   ./script/watcher-role.sh revoke|grant|status [--dry-run]
# Env (from contracts/.env): SEPOLIA_RPC, DEPLOYER_KEY, OWNER_KEY_1, OWNER_KEY_2; optional WATCHER_KEY.
# With WATCHER_KEY set, after the Safe tx the watcher key itself re-writes the current org.copeybara.status value
# (gas limit forced, so the attempt lands on chain): after revoke it must revert, after grant it must succeed.
# Every tx is appended to deployments/sepolia-watcher-role.json (WATCHER_ROLE_FILE).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "${ENV_FILE:-./.env}" ] && { set -a; . "${ENV_FILE:-./.env}"; set +a; }
export PATH=$HOME/.foundry/bin:$PATH
MODE=${1:-}; DRY=${2:-}
case "$MODE" in revoke|grant|status) ;; *) echo "usage: $0 revoke|grant|status [--dry-run]" >&2; exit 2 ;; esac
D=${DEPLOYMENTS_FILE:-deployments/sepolia.json}; OUT=${WATCHER_ROLE_FILE:-deployments/sepolia-watcher-role.json}
LABEL=$(jq -r .label "$D"); RESOLVER=$(jq -r .resolver "$D")
WATCHER=${WATCHER_ADDR:-$(jq -r .copeybara.watcher "$D")}
DNS=0x$(printf '%02x' ${#LABEL})$(printf '%s' "$LABEL" | xxd -p | tr -d '\n')0365746800
ST_RES=$(cast keccak org.copeybara.status); BL_RES=$(cast keccak org.copeybara.blocklist)

roles() {
  local s b
  s=$(cast call "$RESOLVER" "hasRoles(uint256,uint256,address)(bool)" "$ST_RES" 16 "$WATCHER" --rpc-url "$SEPOLIA_RPC")
  b=$(cast call "$RESOLVER" "hasRoles(uint256,uint256,address)(bool)" "$BL_RES" 16 "$WATCHER" --rpc-url "$SEPOLIA_RPC")
  echo "watcher $WATCHER on $LABEL.eth: may write org.copeybara.status=$s org.copeybara.blocklist=$b"
}
record() { # action tx status
  [ -f "$OUT" ] || echo '[]' > "$OUT"
  jq --arg a "$1" --arg t "$2" --arg s "$3" --argjson at "$(date +%s)" '. + [{action:$a, tx:$t, status:$s, at:$at}]' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
}

roles
[ "$MODE" = status ] && exit 0

if [ "$DRY" = "--dry-run" ]; then
  WATCHER_ROLE=$MODE WATCHER_ADDR=$WATCHER forge script script/RevokeWatcher.s.sol --rpc-url "$SEPOLIA_RPC"
  exit 0
fi
WATCHER_ROLE=$MODE WATCHER_ADDR=$WATCHER forge script script/RevokeWatcher.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
RUN=broadcast/RevokeWatcher.s.sol/11155111/run-latest.json
for h in $(jq -r '.receipts[].transactionHash' "$RUN"); do record "safe $MODE" "$h" success; echo "safe $MODE tx $h"; done
roles

if [ -n "${WATCHER_KEY:-}" ]; then
  # re-write the current status value: no state change if it succeeds, on-chain proof either way
  CUR=$(cast call "$RESOLVER" "resolve(bytes,bytes)(bytes)" "$DNS" "$(cast calldata 'text(bytes32,string)' "$(cast namehash "$LABEL.eth")" org.copeybara.status)" --rpc-url "$SEPOLIA_RPC")
  VAL=$(cast abi-decode "f()(string)" "$CUR" | sed 's/^"//; s/"$//')
  [ -n "$VAL" ] || VAL="v=1;state=ok;at=$(date +%s)"
  HASH=$(cast send "$RESOLVER" "setText(bytes,string,string)" "$DNS" org.copeybara.status "$VAL" --private-key "$WATCHER_KEY" --rpc-url "$SEPOLIA_RPC" --gas-limit 200000 --json 2>/dev/null | jq -r '.transactionHash // empty' || true)
  ST=unknown
  [ -n "$HASH" ] && case "$(cast receipt "$HASH" status --rpc-url "$SEPOLIA_RPC")" in 1*|0x1*|true*) ST=success ;; *) ST=revert ;; esac
  record "watcher writes org.copeybara.status after $MODE" "${HASH:-}" "$ST"
  echo "watcher write after $MODE: $ST ${HASH:-}"
  if { [ "$MODE" = revoke ] && [ "$ST" != revert ]; } || { [ "$MODE" = grant ] && [ "$ST" != success ]; }; then
    echo "unexpected: watcher write after $MODE was $ST" >&2; exit 1
  fi
fi
