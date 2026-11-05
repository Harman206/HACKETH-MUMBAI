# One image for every harness service; docker-compose picks the entry point.
FROM node:22-alpine
RUN apk add --no-cache bash docker-cli curl xxd && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ENV BIND_HOST=0.0.0.0
