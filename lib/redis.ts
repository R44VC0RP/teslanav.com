import Redis from "ioredis";

// In-memory Redis running inside the same container (no persistence).
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

declare global {
  var __teslanavRedis: Redis | undefined;
}

function createClient(): Redis {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true, // connect on first command, not at module import
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on("error", (err) => {
    console.error("[Redis] connection error:", err.message);
  });
  return client;
}

/**
 * Lazy singleton (reused across Next.js dev hot-reloads). Creating the client
 * has no side effects - with lazyConnect the socket opens on first command.
 */
export function getRedisClient(): Redis {
  if (!globalThis.__teslanavRedis) {
    globalThis.__teslanavRedis = createClient();
  }
  return globalThis.__teslanavRedis;
}
