#!/bin/sh
set -e

# Start in-memory Redis (no persistence: cache only, lost on restart by design)
redis-server \
  --daemonize yes \
  --bind 127.0.0.1 \
  --port 6379 \
  --save '' \
  --appendonly no \
  --maxmemory 256mb \
  --maxmemory-policy allkeys-lru

# Ensure the SQLite data directory exists (mounted volume in Docker)
mkdir -p "$(dirname "${DATABASE_PATH:-/data/teslanav.db}")"

if [ -n "${ANALYTICS_DIGEST_TO:-}" ] && [ -n "${ADMIN_API_KEY:-}" ]; then
  node scripts/daily-digest-scheduler.mjs &
fi

# Start the Next.js standalone server
exec node server.js
