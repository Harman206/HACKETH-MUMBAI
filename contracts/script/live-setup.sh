#!/usr/bin/env bash
# One-shot live Sepolia setup (Task 4.4). Requires contracts/.env with funded DEPLOYER_KEY.
#   ./script/live-setup.sh
# Steps: deploy Safe + resolver + commit → wait 70 s → register + grant url role → fund web key → must-revert checks.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export PATH=$HOME/.foundry/bin:$PATH
export WEB_KEY_ADDR=$(cast wallet address --private-key "$WEB_KEY")
export MANIFEST_FILE=${MANIFEST_FILE:-../config/manifest.json}
# Placeholder release until the kit is built (Task 7.1 publishes v=2 with the real hash).
export RELEASE=${RELEASE:-"sha256:$(printf 'blackout-placeholder' | shasum -a 256 | cut -d' ' -f1);v=1"}
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_KEY")
echo "deployer $DEPLOYER balance $(cast balance $DEPLOYER --ether --rpc-url $SEPOLIA_RPC) ETH"

if [ ! -f deployments/sepolia.json ] || [ "$(jq -r '.tokenId // empty' deployments/sepolia.json)" = "" ]; then
  if [ ! -f deployments/sepolia.json ]; then
    forge script script/SetupName.s.sol --sig "commit()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow
    echo "committed; waiting 70 s for MIN_COMMITMENT_AGE"; sleep 70
  fi
  forge script script/SetupName.s.sol --sig "finish()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow
fi
jq . deployments/sepolia.json

if [ "$(cast balance "$WEB_KEY_ADDR" --rpc-url "$SEPOLIA_RPC")" = "0" ]; then
  cast send "$WEB_KEY_ADDR" --value 0.01ether --private-key "$DEPLOYER_KEY" --rpc-url "$SEPOLIA_RPC" >/dev/null
fi
# Publish the DemoSwap main-bundle fingerprint for hijack detection (org.blackout.site), once.
if [ ! -f deployments/.site-published ]; then
  env -u RELEASE -u MANIFEST_FILE SITE_HASH="sha256:$(shasum -a 256 ../harness/site/app.js | cut -d' ' -f1)" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow && touch deployments/.site-published
fi
./script/permission-checks.sh
