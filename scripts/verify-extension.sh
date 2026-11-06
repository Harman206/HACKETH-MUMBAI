#!/usr/bin/env bash
# Check an installed (unpacked) extension folder, or the zip, against the org.copeybara.extension ENS record.
# Run this OUTSIDE the extension: a modified extension could report anything about itself.
#   scripts/verify-extension.sh <unpacked dir | zip> [ens-name] [rpc1 rpc2 rpc3]
#   scripts/verify-extension.sh --rebuild <unpacked dir | zip> [ens-name] [rpc1 rpc2 rpc3]
#       rebuild from this checkout and compare bytes first (source → bytes); the ENS check runs only if a name is given
#   scripts/verify-extension.sh --tree-only <unpacked dir>      print the tree hash
# Tree hash = sha256 over the sorted "<path>\t<sha256>\n" lines of every file in the folder (Finder .DS_Store
# files skipped), build-files.json included. Same algorithm as apps/extension/src/shared/buildproof.ts.
# The record is read through 3 RPCs (at least 2 must answer, all answers must agree). Needs Foundry's `cast`.
# Exit: 0 MATCH · 1 MISMATCH · 2 no / bad / old record · 3 RPCs disagree or unreachable · 4 rebuild differs
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
UR=0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe # ENSv2 UniversalResolver on Sepolia
KEY=org.copeybara.extension
DEFAULT_NAME=demoswap-blackout.eth
DEFAULT_RPCS=(https://ethereum-sepolia-rpc.publicnode.com https://sepolia.gateway.tenderly.co https://rpc.sepolia.ethpandaops.io)

sha_file() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
sha_stdin() { if command -v sha256sum >/dev/null; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

tree_lines() { # $1 = unpacked folder → the sorted "<path>\t<sha256>" lines
  (cd "$1" && find . -type f ! -name .DS_Store -print | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r p; do
    printf '%s\t%s\n' "$p" "$(sha_file "$p")"
  done)
}
tree_hash() { tree_lines "$1" | sha_stdin; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Sets DIR (folder to tree-hash) and ZIPSHA (empty for a folder) from a folder or zip path.
open_artifact() {
  local a=$1
  if [ -d "$a" ]; then DIR=$a; ZIPSHA=""; return; fi
  [ -f "$a" ] || { echo "No such file or folder: $a"; exit 2; }
  ZIPSHA=$(sha_file "$a")
  DIR="$TMP/unzipped"; mkdir -p "$DIR"
  unzip -q "$a" -d "$DIR"
}

if [ "${1:-}" = "--tree-only" ]; then tree_hash "${2:?usage: verify-extension.sh --tree-only <dir>}"; exit 0; fi

REBUILD=0
if [ "${1:-}" = "--rebuild" ]; then REBUILD=1; shift; fi
ART=${1:?usage: verify-extension.sh [--rebuild] <unpacked dir | zip> [ens-name] [rpc1 rpc2 rpc3]}
shift
NAME_GIVEN=0
NAME=$DEFAULT_NAME
if [ $# -gt 0 ]; then NAME=$1; NAME_GIVEN=1; shift; fi
RPCS=("$@"); [ ${#RPCS[@]} -eq 0 ] && RPCS=("${DEFAULT_RPCS[@]}")

open_artifact "$ART"
GOT_TREE=$(tree_hash "$DIR")

if [ $REBUILD -eq 1 ]; then
  BROWSER=chrome
  grep -q '"browser_specific_settings"' "$DIR/manifest.json" 2>/dev/null && BROWSER=firefox
  echo "Rebuilding the $BROWSER extension from $(cd "$HERE/.." && pwd)…"
  EXTENSION_OUT_DIR="$TMP/rebuild" node "$HERE/../apps/extension/scripts/build.mjs" >/dev/null 2>&1 || { echo "REBUILD FAILED (run pnpm install first?)"; exit 4; }
  NEW_TREE=$(tree_hash "$TMP/rebuild/$BROWSER")
  NEW_ZIP=$(sha_file "$TMP/rebuild/copeybara-extension-$BROWSER.zip")
  if [ "$NEW_TREE" != "$GOT_TREE" ]; then
    echo "REBUILD MISMATCH tree: this checkout builds $NEW_TREE, $ART has $GOT_TREE"
    echo "  files that differ (< rebuilt, > given):"
    diff <(tree_lines "$TMP/rebuild/$BROWSER") <(tree_lines "$DIR") | grep '^[<>]' | sed 's/^/  /' | head -20 || true
    exit 4
  fi
  if [ -n "$ZIPSHA" ] && [ "$NEW_ZIP" != "$ZIPSHA" ]; then
    echo "REBUILD MISMATCH zip: this checkout builds $NEW_ZIP, $ART is $ZIPSHA (same files, different zip bytes)"; exit 4
  fi
  if [ -n "$ZIPSHA" ]; then echo "REBUILD MATCH tree=$GOT_TREE zip=$ZIPSHA"; else echo "REBUILD MATCH tree=$GOT_TREE"; fi
  [ $NAME_GIVEN -eq 1 ] || exit 0
fi

NAME_LC=$(python3 -c 'import sys;print(sys.argv[1].strip().lower())' "$NAME" 2>/dev/null || printf '%s' "$NAME" | tr 'A-Z' 'a-z')

read_record() { # $1 = rpc index (1-based); prints the record, EMPTY or UNREACHABLE
  local ov="COPEYBARA_EXTENSION_OVERRIDE_$1" v
  if [ -n "${!ov+x}" ]; then v=${!ov}; [ -z "$v" ] && v=EMPTY; echo "$v"; return; fi
  if [ -n "${COPEYBARA_EXTENSION_OVERRIDE+x}" ]; then v=$COPEYBARA_EXTENSION_OVERRIDE; [ -z "$v" ] && v=EMPTY; echo "$v"; return; fi
  local CAST; CAST=$(command -v cast || echo "$HOME/.foundry/bin/cast")
  local rpc=${RPCS[$(($1-1))]} dns inner out
  dns=$(bash "$HERE/verify-kit.sh" --dns-only "$NAME_LC")
  inner=$("$CAST" calldata "text(bytes32,string)" "$("$CAST" namehash "$NAME_LC")" "$KEY")
  out=$(ETH_RPC_TIMEOUT=8 "$CAST" call "$UR" "resolve(bytes,bytes)(bytes,address)" "$dns" "$inner" --rpc-url "$rpc" 2>/dev/null | head -1) || { echo UNREACHABLE; return; }
  [ -z "$out" ] && { echo UNREACHABLE; return; }
  v=$("$CAST" abi-decode "text()(string)" "$out" 2>/dev/null | tr -d '"') || { echo UNREACHABLE; return; }
  [ -z "$v" ] && v=EMPTY; echo "$v"
}

ANSWERS=()
for i in 1 2 3; do
  R=$(read_record "$i" || echo UNREACHABLE)
  [ -n "$R" ] && [ "$R" != "UNREACHABLE" ] && ANSWERS+=("$R")
done
if [ ${#ANSWERS[@]} -lt 2 ]; then echo "TOO FEW RPCS answered for $NAME_LC (${#ANSWERS[@]} of 3); cannot verify right now"; exit 3; fi
for a in "${ANSWERS[@]}"; do
  if [ "$a" != "${ANSWERS[0]}" ]; then echo "RPCS DISAGREE on $KEY of $NAME_LC:"; printf '  %s\n' "${ANSWERS[@]}"; exit 3; fi
done
REC=${ANSWERS[0]}
NOTE="(${#ANSWERS[@]} of 3 RPCs answered)"
[ "$REC" = "EMPTY" ] && { echo "NO EXTENSION RECORD on $NAME_LC ($KEY is empty). Tree hash of $ART: $GOT_TREE"; exit 2; }
if [[ ! "$REC" =~ ^sha256:([0-9a-f]{64})\;v=([1-9][0-9]*)(\;tree=([0-9a-f]{64}))?$ ]]; then
  echo "BAD EXTENSION RECORD on $NAME_LC: '$REC'"; exit 2
fi
WANT_ZIP=${BASH_REMATCH[1]}; VER=${BASH_REMATCH[2]}; WANT_TREE=${BASH_REMATCH[4]:-}

if [ -n "$WANT_TREE" ] && [ "$GOT_TREE" != "$WANT_TREE" ]; then echo "MISMATCH tree expected $WANT_TREE got $GOT_TREE"; exit 1; fi
if [ -n "$ZIPSHA" ] && [ "$ZIPSHA" != "$WANT_ZIP" ]; then echo "MISMATCH zip expected $WANT_ZIP got $ZIPSHA"; exit 1; fi
if [ -z "$WANT_TREE" ] && [ -z "$ZIPSHA" ]; then
  echo "OLD RECORD on $NAME_LC (v=$VER) has only the zip hash $WANT_ZIP; run this on the zip instead. Tree hash of $ART: $GOT_TREE"; exit 2
fi
OUT="MATCH v=$VER"
[ -n "$WANT_TREE" ] && OUT+=" tree=$GOT_TREE"
[ -n "$ZIPSHA" ] && OUT+=" zip=$ZIPSHA"
echo "$OUT $NOTE"
