#!/usr/bin/env bash
# Independent kit verification: compare the file's sha256 with the ENS release record.
# Run this OUTSIDE the kit. The kit cannot verify itself.
#   scripts/verify-kit.sh <blackout-kit.html> <ens-name> [rpc1 rpc2 rpc3]
# Reads org.blackout.release through 3 RPCs and requires them to agree. Needs Foundry's `cast`.
# Exit: 0 MATCH · 1 MISMATCH · 2 bad record · 3 RPCs disagree / unreachable
set -euo pipefail

UR=0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe # ENSv2 UniversalResolver on Sepolia
DEFAULT_RPCS=(https://ethereum-sepolia-rpc.publicnode.com https://sepolia.gateway.tenderly.co https://1rpc.io/sepolia)

# Normalise (lowercase) and DNS-encode a name, label lengths in BYTES.
dns_encode() {
  local name=$1
  if command -v python3 >/dev/null; then
    python3 -c 'import sys; n=sys.argv[1].strip().lower(); print("0x"+"".join("%02x"%len(l.encode())+l.encode().hex() for l in n.split("."))+"00")' "$name"
  else
    name=$(printf '%s' "$name" | tr 'A-Z' 'a-z'); local out=0x l
    IFS=. read -ra L <<< "$name"
    for l in "${L[@]}"; do out+=$(printf '%02x' "$(printf '%s' "$l" | wc -c | tr -d ' ')")$(printf '%s' "$l" | xxd -p | tr -d '\n'); done
    echo "${out}00"
  fi
}

if [ "${1:-}" = "--dns-only" ]; then dns_encode "$2"; exit 0; fi
# --release-only <name> <rpc>: print the raw org.blackout.release record (used by the live runbook)
if [ "${1:-}" = "--release-only" ]; then
  CAST=$(command -v cast || echo "$HOME/.foundry/bin/cast"); N=$(printf '%s' "$2" | tr 'A-Z' 'a-z')
  OUT=$("$CAST" call "$UR" "resolve(bytes,bytes)(bytes,address)" "$(dns_encode "$N")" "$("$CAST" calldata "text(bytes32,string)" "$("$CAST" namehash "$N")" org.blackout.release)" --rpc-url "$3" | head -1)
  "$CAST" abi-decode "text()(string)" "$OUT" | tr -d '"'; exit 0
fi

FILE=${1:?usage: verify-kit.sh <file> <ens-name> [rpc1 rpc2 rpc3]}
NAME=${2:?usage: verify-kit.sh <file> <ens-name> [rpc1 rpc2 rpc3]}
shift 2
RPCS=("$@"); [ ${#RPCS[@]} -eq 0 ] && RPCS=("${DEFAULT_RPCS[@]}")
NAME_LC=$(python3 -c 'import sys;print(sys.argv[1].strip().lower())' "$NAME" 2>/dev/null || printf '%s' "$NAME" | tr 'A-Z' 'a-z')

if command -v sha256sum >/dev/null; then GOT=$(sha256sum "$FILE" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$FILE" | cut -d' ' -f1); fi

read_release() { # $1 = rpc index (1-based)
  local i=$1 ov="BLACKOUT_RELEASE_OVERRIDE_$1"
  if [ -n "${!ov:-}" ]; then echo "${!ov}"; return; fi
  if [ -n "${BLACKOUT_RELEASE_OVERRIDE:-}" ]; then echo "$BLACKOUT_RELEASE_OVERRIDE"; return; fi
  local CAST; CAST=$(command -v cast || echo "$HOME/.foundry/bin/cast")
  local rpc=${RPCS[$((i-1))]} dns inner out
  dns=$(dns_encode "$NAME_LC")
  inner=$("$CAST" calldata "text(bytes32,string)" "$("$CAST" namehash "$NAME_LC")" org.blackout.release)
  out=$(ETH_RPC_TIMEOUT=8 "$CAST" call "$UR" "resolve(bytes,bytes)(bytes,address)" "$dns" "$inner" --rpc-url "$rpc" 2>/dev/null | head -1) || { echo "UNREACHABLE"; return; }
  [ -z "$out" ] && { echo "UNREACHABLE"; return; }
  "$CAST" abi-decode "text()(string)" "$out" 2>/dev/null | tr -d '"' || echo "UNREACHABLE"
}

# Same rule as the kit's quorum: at least 2 must answer, and every answer must agree (an unreachable RPC does not count).
ANSWERS=()
for i in 1 2 3; do
  R=$(read_release "$i" || echo UNREACHABLE)
  [ -n "$R" ] && [ "$R" != "UNREACHABLE" ] && ANSWERS+=("$R")
done
if [ ${#ANSWERS[@]} -lt 2 ]; then
  echo "TOO FEW RPCS answered for $NAME_LC (${#ANSWERS[@]} of 3); cannot verify right now"; exit 3
fi
for a in "${ANSWERS[@]}"; do
  if [ "$a" != "${ANSWERS[0]}" ]; then
    echo "RPCS DISAGREE on the release record of $NAME_LC:"; printf '  %s\n' "${ANSWERS[@]}"; exit 3
  fi
done
RELEASE=${ANSWERS[0]}
NOTE="(${#ANSWERS[@]} of 3 RPCs answered)"

if [[ ! "$RELEASE" =~ ^sha256:([0-9a-f]{64})\;v=([1-9][0-9]*)$ ]]; then
  echo "BAD RELEASE RECORD on $NAME_LC: '$RELEASE'"; exit 2
fi
WANT=${BASH_REMATCH[1]}; VER=${BASH_REMATCH[2]}
if [ "$GOT" = "$WANT" ]; then echo "MATCH v=$VER $GOT $NOTE"; exit 0; fi
echo "MISMATCH expected $WANT got $GOT"; exit 1
