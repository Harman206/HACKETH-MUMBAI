#!/usr/bin/env bash
# Live must-revert evidence on Sepolia. Each attack is SENT (gas limit forced, so no estimation)
# from the website key, so it lands on chain as a reverted transaction with a citable hash.
# Env: SEPOLIA_RPC, WEB_KEY (private key). Reads deployments/sepolia.json, writes deployments/sepolia-permissions.json.
set -euo pipefail
cd "$(dirname "$0")/.."
D=${DEPLOYMENTS_FILE:-deployments/sepolia.json}; OUT=${PERMISSIONS_FILE:-deployments/sepolia-permissions.json}
LABEL=$(jq -r .label $D); RESOLVER=$(jq -r .resolver $D); TOKEN=$(jq -r .tokenId $D)
REGISTRY=$(jq -r .ens.ethRegistry ../config/networks.json); IMPL=$(jq -r .ens.permissionedResolverImpl ../config/networks.json)
DNS=0x$(printf '%02x' ${#LABEL})$(printf '%s' "$LABEL" | xxd -p | tr -d '\n')0365746800
WEB=$(cast wallet address --private-key "$WEB_KEY")
REL_SETTER=$(cast calldata "setText(bytes,string,string)" $DNS org.blackout.release "")

send() { # name to sig args...
  local name=$1 to=$2; shift 2
  local hash; hash=$(cast send "$to" "$@" --private-key "$WEB_KEY" --rpc-url "$SEPOLIA_RPC" --gas-limit 300000 --json 2>/dev/null | jq -r .transactionHash || true)
  local status; status=$(cast receipt "$hash" status --rpc-url "$SEPOLIA_RPC" 2>/dev/null || echo unknown)
  echo "{\"check\":\"$name\",\"tx\":\"$hash\",\"status\":\"$status\"}"
}

{
  echo '['
  send "web key writes org.blackout.release (must revert)" $RESOLVER "setText(bytes,string,string)" $DNS org.blackout.release "sha256:$(printf 'ee%.0s' {1..32});v=99"; echo ,
  send "web key swaps resolver on registry (must revert)" $REGISTRY "setResolver(uint256,address)" $TOKEN $WEB; echo ,
  send "web key upgrades resolver proxy (must revert)" $RESOLVER "upgradeToAndCall(address,bytes)" $IMPL 0x; echo ,
  send "web key grants itself the release setter (must revert)" $RESOLVER "grantSetterRoles(bytes,address)" $REL_SETTER $WEB; echo ,
  send "web key grants itself root text role (must revert)" $RESOLVER "grantRootRoles(uint256,address)" 16 $WEB; echo ,
  send "web key writes url (must succeed)" $RESOLVER "setText(bytes,string,string)" $DNS url "https://demoswap.example/?rotated=$(date +%s)"
  echo ']'
} | jq . > "$OUT"
jq -r '.[] | "\(.status)\t\(.check)\t\(.tx)"' "$OUT"
