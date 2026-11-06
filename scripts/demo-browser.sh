#!/usr/bin/env bash
# Opens a demo browser with the Copeybara extension already loaded (no clicks needed).
#   scripts/demo-browser.sh            → Chrome for Testing, own profile in ~/.copeybara-demo-profile
#   scripts/demo-browser.sh --chrome   → your normal Google Chrome: opens chrome://extensions and copies the
#                                         extension folder path, for a one-time "Load unpacked" (Chrome 137+
#                                         no longer accepts --load-extension, so this step is manual there)
# The profile persists: install MetaMask in it once (Chrome Web Store) and it stays for every demo.
set -euo pipefail
cd "$(dirname "$0")/.."
EXT="$PWD/apps/extension/dist/chrome"
[ -f "$EXT/manifest.json" ] || node apps/extension/scripts/build.mjs >/dev/null

if [ "${1:-}" = "--chrome" ]; then
  printf '%s' "$EXT" | pbcopy
  osascript -e 'tell application "Google Chrome" to activate' -e 'tell application "Google Chrome" to open location "chrome://extensions"'
  cat <<EOF
In Chrome (now open on chrome://extensions):
  1. Turn on "Developer mode" (top right).
  2. Click "Load unpacked", press Cmd+Shift+G, paste (Cmd+V) and press Enter, then "Select".
     (The folder path is already on your clipboard: $EXT)
  3. Pin Copeybara (puzzle icon → pin). Click it to open the side panel.
After a rebuild, press the ↻ reload button on the Copeybara card.
EOF
  exit 0
fi

CFT=$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/"Google Chrome for Testing.app" 2>/dev/null | sort -V | tail -1)
[ -n "$CFT" ] || { echo "Chrome for Testing not found: run 'cd apps/kit && pnpm exec playwright install chromium'"; exit 1; }
PROFILE="${COPEYBARA_PROFILE:-$HOME/.copeybara-demo-profile}"
mkdir -p "$PROFILE"
"$CFT/Contents/MacOS/Google Chrome for Testing" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --no-first-run --no-default-browser-check \
  "https://blackout-red.vercel.app/" "http://demoswap.localhost:8080/" >/dev/null 2>&1 &
echo "Demo browser started with Copeybara loaded (profile: $PROFILE)."
echo "First time only: install MetaMask from the Chrome Web Store in this window, then run the Copeybara setup."
