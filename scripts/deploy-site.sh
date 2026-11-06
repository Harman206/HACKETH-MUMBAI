#!/usr/bin/env bash
# Build the kit + website and publish the static site to Vercel production.
#   scripts/deploy-site.sh            (needs `vercel login`; scope via VERCEL_SCOPE)
set -euo pipefail
cd "$(dirname "$0")/.."
SCOPE=${VERCEL_SCOPE:-harman206s-projects}
SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build >/dev/null
node apps/extension/scripts/build.mjs >/dev/null
pnpm --filter @copeybara/site build >/dev/null
rm -rf deploy/blackout/assets deploy/blackout/*.html deploy/blackout/*.sha256 deploy/blackout/demo-runs
mkdir -p deploy/blackout && cp -R apps/site/dist/. deploy/blackout/
[ -f deploy/blackout/vercel.json ] || cp scripts/vercel.site.json deploy/blackout/vercel.json
( cd deploy/blackout && vercel deploy --prod --yes --scope "$SCOPE" )
# The hosted kit must still match the ENS release record.
curl -s https://blackout-red.vercel.app/blackout-kit.html -o /tmp/blackout-hosted-kit.html
scripts/verify-kit.sh /tmp/blackout-hosted-kit.html demoswap-blackout.eth
