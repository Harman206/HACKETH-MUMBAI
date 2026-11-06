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
    forge script script/SetupName.s.sol --sig "commit()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow \
      || forge script script/SetupName.s.sol --sig "commit()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow --resume
    echo "committed; waiting 70 s for MIN_COMMITMENT_AGE"; sleep 70
    # local fork rehearsal only: anvil does not mine empty blocks, so advance the chain clock
    case "$SEPOLIA_RPC" in http://127.0.0.1*|http://localhost*) cast rpc evm_mine --rpc-url "$SEPOLIA_RPC" >/dev/null ;; esac
  fi
  case "$SEPOLIA_RPC" in http://127.0.0.1*|http://localhost*) cast rpc evm_mine --rpc-url "$SEPOLIA_RPC" >/dev/null ;; esac
  forge script script/SetupName.s.sol --sig "finish()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow \
    || forge script script/SetupName.s.sol --sig "finish()" --rpc-url "$SEPOLIA_RPC" --broadcast --slow --resume
fi
jq . "$DF"

# Publish the DemoSwap main-bundle fingerprint for hijack detection (org.blackout.site), once.
if [ ! -f "$DF.site-published" ]; then
  env -u RELEASE -u MANIFEST_FILE SITE_HASH="$(node ../scripts/site-hash.mjs ../harness/site/app.js)" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow && touch "$DF.site-published"
fi
if [ -f "$PERMISSIONS_FILE" ] && [ "$(jq '[.[] | select(.pass | not)] | length' "$PERMISSIONS_FILE")" = "0" ] && [ -z "${FORCE_PERMISSION_CHECKS:-}" ]; then
  echo "permission checks already recorded and passing ($PERMISSIONS_FILE); set FORCE_PERMISSION_CHECKS=1 to resend"
else
  # Top the web key up only when the checks will actually be sent (6 sends x 300k gas limit need headroom).
  if [ "$(cast balance "$WEB_KEY_ADDR" --rpc-url "$SEPOLIA_RPC")" -lt 30000000000000000 ]; then
    cast send "$WEB_KEY_ADDR" --value 0.05ether --private-key "$DEPLOYER_KEY" --rpc-url "$SEPOLIA_RPC" >/dev/null
  fi
  ./script/permission-checks.sh
fi

# Publish the kit fingerprint as the next release version, once per kit build.
( cd .. && SOURCE_DATE_EPOCH=0 pnpm --filter @blackout/kit build >/dev/null )
KIT_SHA=$(cut -d' ' -f1 ../apps/kit/dist/blackout-kit.html.sha256)
if [ "$(jq -r '.kitRelease // empty' "$DF")" != "$KIT_SHA" ]; then
  # Versions only go up: read the live record, publish current + 1.
  NAME_NOW=$(jq -r .name "$DF")
  CUR=$(../scripts/verify-kit.sh --release-only "$NAME_NOW" "$SEPOLIA_RPC" | sed -n 's/.*;v=\([0-9]*\).*/\1/p')
  KIT_VERSION=${KIT_VERSION:-$(( ${CUR:-1} + 1 ))}
  echo "publishing release v=$KIT_VERSION (was v=${CUR:-none})"
  env -u MANIFEST_FILE RELEASE="sha256:$KIT_SHA;v=$KIT_VERSION" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
  jq --arg s "$KIT_SHA" --argjson v "$KIT_VERSION" '.kitRelease=$s | .kitReleaseVersion=$v' "$DF" > /tmp/bo.json && mv /tmp/bo.json "$DF"
fi
# ENS-hosted kit: its IPFS CIDv1 (raw) is multihash(sha256), so contenthash = 0xe30101551220<sha256>.
# Only after the kit file is pinned on IPFS (IPFS_PINNED=1): never point ENS at content nobody serves.
CH="0xe30101551220$KIT_SHA"
if [ "${IPFS_PINNED:-0}" = "1" ] && [ "$(jq -r '.contenthash // empty' "$DF")" != "$CH" ]; then
  echo "publishing contenthash $CH"
  env -u RELEASE -u MANIFEST_FILE -u SITE_HASH CONTENTHASH="$CH" forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
  jq --arg s "$CH" '.contenthash=$s' "$DF" > /tmp/bo.json && mv /tmp/bo.json "$DF"
elif [ "${IPFS_PINNED:-0}" != "1" ]; then
  echo "contenthash not published: pin apps/kit/dist/blackout-kit.html on IPFS (CIDv1, raw leaves), then rerun with IPFS_PINNED=1"
fi
# Publish the exit manifest whenever config/manifest.json changed since the last publish (same Safe 2-of-3 path).
MF_SHA=$(shasum -a 256 "$MANIFEST_FILE" | cut -d' ' -f1)
if [ "$(jq -r '.manifestSha // empty' "$DF")" != "$MF_SHA" ]; then
  echo "publishing exit manifest (sha256 $MF_SHA)"
  env -u RELEASE -u SITE_HASH forge script script/WriteRecords.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow
  jq --arg s "$MF_SHA" '.manifestSha=$s' "$DF" > /tmp/bo.json && mv /tmp/bo.json "$DF"
fi
# Independent check through 3 public RPCs (a local fork rehearsal can only use the fork itself).
case "$SEPOLIA_RPC" in
  http://127.0.0.1*|http://localhost*) ../scripts/verify-kit.sh ../apps/kit/dist/blackout-kit.html "$(jq -r .name "$DF")" "$SEPOLIA_RPC" "$SEPOLIA_RPC" "$SEPOLIA_RPC" ;;
  *) ../scripts/verify-kit.sh ../apps/kit/dist/blackout-kit.html "$(jq -r .name "$DF")" ;;
esac

# Seed three Uniswap v3 test positions into DEMO_WALLET (your MetaMask address), once.
POS=${POSITIONS_FILE:-${DF%.json}-positions.json}
if [ ! -f "$POS" ]; then
  TEST_WALLET_KEY=$DEPLOYER_KEY POSITIONS_FILE=$POS forge script script/SeedPositions.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow \
    || TEST_WALLET_KEY=$DEPLOYER_KEY POSITIONS_FILE=$POS forge script script/SeedPositions.s.sol --rpc-url "$SEPOLIA_RPC" --broadcast --slow --resume
fi
jq . "$POS"

# Fill the README's live-deployment section (real deployment only; rehearsals never touch the README).
if [ "$DF" = "deployments/sepolia.json" ]; then ( cd .. && node scripts/readme-live.mjs contracts/deployments/sepolia.json README.md ); fi
echo "Live setup complete. Next: open the kit on http://localhost, connect MetaMask as $(jq -r .wallet "$POS"), exit the three positions."
