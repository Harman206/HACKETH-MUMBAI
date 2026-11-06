# Copeybara watcher. Build from the repo root:
#   docker build -f apps/watcher/Dockerfile -t copeybara-watcher .
# Or generate a compose file from copeybara.config.ts:  copeybara watcher --up
# The key it runs with may write only org.copeybara.status and org.copeybara.blocklist (granted by the Safe).
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY config ./config
COPY packages/core ./packages/core
COPY packages/ens ./packages/ens
COPY packages/quorum ./packages/quorum
COPY packages/sitecheck ./packages/sitecheck
COPY apps/watcher ./apps/watcher
RUN pnpm install --frozen-lockfile --filter @copeybara/watcher... && chown -R node:node /repo
USER node
ENV STATUS_PORT=8787 STATUS_HOST=127.0.0.1 INTERVAL_MS=15000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.STATUS_PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["pnpm", "--filter", "@copeybara/watcher", "start"]
