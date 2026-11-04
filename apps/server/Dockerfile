# Subby Sync server. Build from the repository root (the server bundles the shared workspace package):
#   docker build -f apps/server/Dockerfile -t kindred-sync .

FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so dependency layers are cached until they change. Every workspace manifest is copied so the
# frozen lockfile matches; only the server and what it needs are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@kindred-log/server..."
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @kindred-log/server build
# The bundle (dist/main.js) already contains the shared package; at runtime only the server's own npm dependencies
# are needed. They're pinned to the exact versions the build used. (pnpm deploy would also pull in the app's
# React Native tree through drizzle-orm's optional peers, shared with the app in the lockfile.)
RUN cd apps/server && mkdir /out && pnpm list --prod --depth 0 --json | node -e " \
  const [server] = JSON.parse(require('fs').readFileSync(0, 'utf8')); \
  const deps = Object.entries(server.dependencies).filter(([name]) => !name.startsWith('@kindred-log/')); \
  const pkg = { name: 'kindred-sync', private: true, type: 'module', dependencies: Object.fromEntries(deps.map(([n, d]) => [n, d.version])) }; \
  require('fs').writeFileSync('/out/package.json', JSON.stringify(pkg, null, 2));"

# Runtime: pure-JS dependencies only, so the small Alpine image is enough.
FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 BLOB_DIR=/data/blobs
WORKDIR /app
COPY --from=build /out/package.json ./
# No install scripts: the dependencies are pure JS and need none.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
RUN mkdir -p /data/blobs && chown -R node:node /data
USER node
# Encrypted photos (BLOB_STORE=disk). Postgres holds everything else.
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/v1/info').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
