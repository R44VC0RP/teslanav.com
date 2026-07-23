# syntax=docker/dockerfile:1

# TeslaNav - fully self-contained: Next.js + in-memory Redis + SQLite in one container.

# ---- deps: install node_modules (with native build tools for better-sqlite3) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install

# ---- build: compile the Next.js standalone output ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: Next.js standalone + in-memory Redis + SQLite data dir ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends redis-server \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    REDIS_URL=redis://127.0.0.1:6379 \
    DATABASE_PATH=/data/teslanav.db

# Next.js standalone output (includes traced node_modules)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# better-sqlite3 is external to the bundle; install its prebuilt binary explicitly
RUN npm install --omit=dev --no-save better-sqlite3@^12 \
  && npm cache clean --force

COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY scripts/daily-digest-scheduler.mjs ./scripts/daily-digest-scheduler.mjs
RUN chmod +x docker-entrypoint.sh && mkdir -p /data

EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["./docker-entrypoint.sh"]
