#!/usr/bin/env bash
# Independent kit verification: compare the file's sha256 with the ENS release record.
# Run this OUTSIDE the kit. The kit cannot verify itself.
#   scripts/verify-kit.sh <blackout-kit.html> <ens-name> [rpc-url]
# Needs Foundry's `cast` (or set BLACKOUT_RELEASE_OVERRIDE for tests).
set -euo pipefail
FILE=${1:?usage: verify-kit.sh <file> <ens-name> [rpc]}
NAME=${2:?usage: verify-kit.sh <file> <ens-name> [rpc]}
RPC=${3:-https://ethereum-sepolia-rpc.publicnode.com}
UR=0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe # ENSv2 UniversalResolver on Sepolia

if command -v sha256sum >/dev/null; then GOT=$(sha256sum "$FILE" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$FILE" | cut -d' ' -f1); fi

if [ -n "${BLACKOUT_RELEASE_OVERRIDE:-}" ]; then
  RELEASE=$BLACKOUT_RELEASE_OVERRIDE
else
  CAST=$(command -v cast || echo "$HOME/.foundry/bin/cast")
  DNS=0x; IFS=. read -ra L <<< "$NAME"
  for l in "${L[@]}"; do DNS+=$(printf '%02x' ${#l})$(printf '%s' "$l" | xxd -p | tr -d '\n'); done; DNS+=00
  INNER=$("$CAST" calldata "text(bytes32,string)" "$("$CAST" namehash "$NAME")" org.blackout.release)
  OUT=$("$CAST" call "$UR" "resolve(bytes,bytes)(bytes,address)" "$DNS" "$INNER" --rpc-url "$RPC" | head -1)
  RELEASE=$("$CAST" abi-decode "text()(string)" "$OUT" | tr -d '"')
fi

if [[ ! "$RELEASE" =~ ^sha256:([0-9a-f]{64})\;v=([1-9][0-9]*)$ ]]; then
  echo "BAD RELEASE RECORD on $NAME: '$RELEASE'"; exit 2
fi
WANT=${BASH_REMATCH[1]}; VER=${BASH_REMATCH[2]}
if [ "$GOT" = "$WANT" ]; then echo "MATCH v=$VER $GOT"; exit 0; fi
echo "MISMATCH expected $WANT got $GOT"; exit 1
