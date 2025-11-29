import { Redis } from "@upstash/redis";

// Create Redis client from environment variables
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Cache key prefixes
export const CACHE_KEYS = {
  WAZE_ALERTS: "waze:alerts:",
  WAZE_RATE_LIMIT: "waze:ratelimit",
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  WAZE_ALERTS: 60, // 60 seconds for Waze alerts
  RATE_LIMIT_WINDOW: 60, // 1 minute window for rate limiting
} as const;

// Global rate limit settings
export const RATE_LIMITS = {
  WAZE_REQUESTS_PER_MINUTE: 30, // Max 30 requests to Waze per minute across all users
} as const;

