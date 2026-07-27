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
# schema.sql is data, not TypeScript, so tsc does not copy it.
RUN cp src/schema.sql dist/schema.sql

# --- runtime ------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=web /build/public ./public
COPY data/cmudict-0.7b.txt data/CMUDICT-LICENSE.txt ./data/
RUN chown -R node:node /app/data
USER node
EXPOSE 5180
# --experimental-sqlite is required on Node 22. On Node 24 the flag is no longer
# needed, but passing it is still accepted.
CMD ["node", "--experimental-sqlite", "dist/index.js"]
