#!/usr/bin/env bash
# One-shot live Sepolia setup (Task 4.4). Requires contracts/.env with funded DEPLOYER_KEY.
#   ./script/live-setup.sh
# Steps: deploy Safe + resolver + commit → wait 70 s → register + grant url role → fund web key → must-revert checks.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . "${ENV_FILE:-./.env}"; set +a
export PATH=$HOME/.foundry/bin:$PATH
export WEB_KEY_ADDR=$(cast wallet address --private-key "$WEB_KEY")
export MANIFEST_FILE=${MANIFEST_FILE:-../config/manifest.json}
# Placeholder release until the kit is built (Task 7.1 publishes v=2 with the real hash).
export RELEASE=${RELEASE:-"sha256:$(printf 'blackout-placeholder' | shasum -a 256 | cut -d' ' -f1);v=1"}
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_KEY")
export DEPLOYMENTS_FILE=${DEPLOYMENTS_FILE:-deployments/sepolia.json}
DF=$DEPLOYMENTS_FILE
export PERMISSIONS_FILE=${PERMISSIONS_FILE:-${DF%.json}-permissions.json}
echo "deployer $DEPLOYER balance $(cast balance $DEPLOYER --ether --rpc-url $SEPOLIA_RPC) ETH"

if [ ! -f "$DF" ] || [ "$(jq -r '.tokenId // empty' "$DF")" = "" ]; then
  if [ ! -f "$DF" ]; then
    forge script script/SetupName.s.sol --sig "commit()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow
    echo "committed; waiting 70 s for MIN_COMMITMENT_AGE"; sleep 70
    # local fork rehearsal only: anvil does not mine empty blocks, so advance the chain clock
    case "$SEPOLIA_RPC" in http://127.0.0.1*|http://localhost*) cast rpc evm_mine --rpc-url "$SEPOLIA_RPC" >/dev/null ;; esac
  fi
  case "$SEPOLIA_RPC" in http://127.0.0.1*|http://localhost*) cast rpc evm_mine --rpc-url "$SEPOLIA_RPC" >/dev/null ;; esac
  forge script script/SetupName.s.sol --sig "finish()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow
fi
jq . "$DF"

if [ "$(cast balance "$WEB_KEY_ADDR" --rpc-url "$SEPOLIA_RPC")" = "0" ]; then
  cast send "$WEB_KEY_ADDR" --value 0.01ether --private-key "$DEPLOYER_KEY" --rpc-url "$SEPOLIA_RPC" >/dev/null
fi
# Publish the DemoSwap main-bundle fingerprint for hijack detection (org.blackout.site), once.
if [ ! -f "$DF.site-published" ]; then
  env -u RELEASE -u MANIFEST_FILE SITE_HASH="sha256:$(shasum -a 256 ../harness/site/app.js | cut -d' ' -f1)" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow && touch "$DF.site-published"
fi
./script/permission-checks.sh

# Publish the real kit fingerprint as release v2 (v1 was a placeholder), once per kit build.
( cd .. && SOURCE_DATE_EPOCH=0 pnpm --filter @blackout/kit build >/dev/null )
KIT_SHA=$(cut -d' ' -f1 ../apps/kit/dist/blackout-kit.html.sha256)
if [ "$(jq -r '.kitRelease // empty' "$DF")" != "$KIT_SHA" ]; then
  env -u MANIFEST_FILE RELEASE="sha256:$KIT_SHA;v=${KIT_VERSION:-2}" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
  jq --arg s "$KIT_SHA" '.kitRelease=$s' "$DF" > /tmp/bo.json && mv /tmp/bo.json "$DF"
fi
../scripts/verify-kit.sh ../apps/kit/dist/blackout-kit.html "$(jq -r .name "$DF")" "$SEPOLIA_RPC"

# Seed three Uniswap v3 test positions into DEMO_WALLET (your MetaMask address), once.
POS=${POSITIONS_FILE:-deployments/sepolia-positions.json}
if [ ! -f "$POS" ]; then
  TEST_WALLET_KEY=$DEPLOYER_KEY POSITIONS_FILE=$POS forge script script/SeedPositions.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
fi
jq . "$POS"
