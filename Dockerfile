# ── Build: install everything, build the web app and bundle the server ──
FROM node:26-alpine AS build
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
FROM node:26-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/quiz.db
WORKDIR /app
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/web/dist-ssr apps/web/dist-ssr
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "--enable-source-maps", "apps/server/dist/index.mjs"]
