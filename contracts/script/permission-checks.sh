#!/usr/bin/env bash
# Live must-revert evidence on Sepolia. Each attack is SENT (gas limit forced, so no estimation)
# from the website key, so it lands on chain as a reverted transaction with a citable hash.
# Env: SEPOLIA_RPC, WEB_KEY (private key). Reads deployments/sepolia.json, writes deployments/sepolia-permissions.json.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=$HOME/.foundry/bin:$PATH
D=${DEPLOYMENTS_FILE:-deployments/sepolia.json}; OUT=${PERMISSIONS_FILE:-deployments/sepolia-permissions.json}
LABEL=$(jq -r .label $D); RESOLVER=$(jq -r .resolver $D); TOKEN=$(jq -r .tokenId $D)
REGISTRY=$(jq -r .ens.ethRegistry ../config/networks.json); IMPL=$(jq -r .ens.permissionedResolverImpl ../config/networks.json)
DNS=0x$(printf '%02x' ${#LABEL})$(printf '%s' "$LABEL" | xxd -p | tr -d '\n')0365746800
WEB=$(cast wallet address --private-key "$WEB_KEY")
REL_SETTER=$(cast calldata "setText(bytes,string,string)" $DNS org.blackout.release "")

send() { # expected name to sig args...   expected = revert | success
  local expected=$1 name=$2 to=$3; shift 3
  local hash; hash=$(cast send "$to" "$@" --private-key "$WEB_KEY" --rpc-url "$SEPOLIA_RPC" --gas-limit 300000 --json 2>/dev/null | jq -r '.transactionHash // empty' || true)
  local raw="" status=unknown
  if [ -n "$hash" ]; then raw=$(cast receipt "$hash" status --rpc-url "$SEPOLIA_RPC" 2>/dev/null || true); fi
  case "$raw" in 1*|true*|0x1*) status=success ;; 0*|false*|0x0*) status=revert ;; esac
  local pass=false; [ "$status" = "$expected" ] && pass=true
  jq -n --arg c "$name" --arg t "${hash:-}" --arg s "$status" --arg e "$expected" --argjson p $pass '{check:$c,tx:$t,status:$s,expected:$e,pass:$p}'
}

{
  echo '['
  send revert "web key writes org.blackout.release" $RESOLVER "setText(bytes,string,string)" $DNS org.blackout.release "sha256:$(printf 'ee%.0s' {1..32});v=99"; echo ,
  send revert "web key swaps resolver on registry" $REGISTRY "setResolver(uint256,address)" $TOKEN $WEB; echo ,
  send revert "web key upgrades resolver proxy" $RESOLVER "upgradeToAndCall(address,bytes)" $IMPL 0x; echo ,
  send revert "web key grants itself the release setter" $RESOLVER "grantSetterRoles(bytes,address)" $REL_SETTER $WEB; echo ,
  send revert "web key grants itself root text role" $RESOLVER "grantRootRoles(uint256,address)" 16 $WEB; echo ,
  send success "web key writes url" $RESOLVER "setText(bytes,string,string)" $DNS url "https://demoswap.example/?rotated=$(date +%s)"
  echo ']'
} | jq . > "$OUT"
jq -r '.[] | "\(if .pass then "PASS" else "FAIL" end)\t\(.status) (expected \(.expected))\t\(.check)\t\(.tx)"' "$OUT"
if [ "$(jq '[.[] | select(.pass | not)] | length' "$OUT")" != "0" ]; then
  echo "permission checks FAILED (see $OUT). Is the web key funded?" >&2
  exit 1
fi
echo "all permission checks passed"
