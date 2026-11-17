# Subby Sync server. Build from the repository root (the server bundles the shared workspace package):
#   docker build -f apps/server/Dockerfile -t subby-sync .

FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so dependency layers are cached until they change. Every workspace manifest is copied so the
# frozen lockfile matches; only the server and what it needs are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@subby/server..."
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @subby/server build
# The bundle (dist/main.js) already contains the shared package; at runtime only the server's own npm dependencies
# are needed, pinned with every transitive dependency by runtime/package-lock.json. The check fails the build when
# runtime/package.json no longer matches what pnpm resolved (run `pnpm runtime-lock` in apps/server).
RUN cd apps/server && node scripts/runtime-deps.mjs --check

# Runtime: pure-JS dependencies only, so the small Alpine image is enough.
FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 BLOB_DIR=/data/blobs
WORKDIR /app
COPY apps/server/runtime/package.json apps/server/runtime/package-lock.json ./
# Exactly the locked versions. No install scripts: the dependencies are pure JS and need none.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
RUN mkdir -p /data/blobs && chown -R node:node /data
USER node
# Encrypted photos (BLOB_STORE=disk). Postgres holds everything else.
VOLUME /data
EXPOSE 8787
# Busybox wget, not `node -e fetch`: starting a second Node every 30 s cost ~65 MB and 40 ms of CPU each time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -q -O /dev/null "http://127.0.0.1:$PORT/v1/info" || exit 1
CMD ["node", "dist/main.js"]
