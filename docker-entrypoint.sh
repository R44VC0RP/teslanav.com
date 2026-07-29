#!/bin/sh
set -e

# Start Redis with RDB persistence on the /data volume so Waze snapshots and
# rate-limit counters survive deploys. Every key carries a TTL (stored as an
# absolute timestamp in the dump), and waze-rt.ts refuses snapshots older
# than five minutes, so reloading an old dump is always safe.
mkdir -p /data/redis

start_redis() {
  redis-server \
    --daemonize yes \
    --bind 127.0.0.1 \
    --port 6379 \
    --dir /data/redis \
    --dbfilename cache.rdb \
    --save 60 1 \
    --appendonly no \
    --maxmemory 256mb \
    --maxmemory-policy allkeys-lru
}

redis_ready() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if redis-cli -p 6379 ping >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

start_redis || true
if ! redis_ready; then
  # A corrupt dump must never keep the site down: drop it and start fresh.
  echo "Redis did not come up; discarding cache dump and retrying" >&2
  rm -f /data/redis/cache.rdb
  start_redis || true
  redis_ready || echo "Redis still unavailable; continuing without cache" >&2
fi

# Ensure the SQLite data directory exists (mounted volume in Docker)
mkdir -p "$(dirname "${DATABASE_PATH:-/data/teslanav.db}")"

if [ -n "${ANALYTICS_DIGEST_TO:-}" ] && [ -n "${ADMIN_API_KEY:-}" ]; then
  node scripts/daily-digest-scheduler.mjs &
fi

# Start the Next.js standalone server
exec node server.js
