# Node 22 LTS. node:sqlite is built in, so there is no node-gyp step and no
# native compile on ARM — this image builds identically on x86 and on a Pi.

# --- frontend -----------------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/src ./src
# vite.config.ts emits to ../public, i.e. /build/public.
RUN npm run build

# --- server -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime ------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=web /build/public ./public
COPY data/cmudict-0.7b.txt data/CMUDICT-LICENSE.txt ./data/
# schema.sql and migrations/ are data src/db.ts reads at startup (resolved
# from process.cwd(), never import.meta.url — see src/db.ts) — copied
# straight from source rather than duplicated into dist/.
COPY --from=build /app/src/schema.sql ./src/schema.sql
COPY --from=build /app/src/migrations ./src/migrations
RUN chown -R node:node /app/data
USER node
EXPOSE 5180
# --experimental-sqlite is required on Node 22. On Node 24 the flag is no longer
# needed, but passing it is still accepted.
CMD ["node", "--experimental-sqlite", "dist/index.js"]
