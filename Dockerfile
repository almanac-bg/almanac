# ── Build: install everything, build the web app and bundle the server ──
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime: plain Node, no node_modules (the server bundle is self-contained) ──
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
# UV_THREADPOOL_SIZE: password hashing shares libuv's threads with file reads and DNS lookups; 8 instead of the
# default 4 leaves them room while hashes run (see hashingLimits in apps/server/src/auth.ts).
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/quiz.db \
    UV_THREADPOOL_SIZE=8
WORKDIR /app
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/web/dist-ssr apps/web/dist-ssr
# The server needs node alone: no package manager in the running image to fetch or run anything else.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm \
      /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
    && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "--enable-source-maps", "apps/server/dist/index.mjs"]
