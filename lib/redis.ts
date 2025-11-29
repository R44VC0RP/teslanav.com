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
  OSM_CAMERAS: "osm:cameras:",
  OSM_RATE_LIMIT: "osm:ratelimit",
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  WAZE_ALERTS: 60, // 60 seconds for Waze alerts
  RATE_LIMIT_WINDOW: 60, // 1 minute window for rate limiting
  OSM_CAMERAS: 3600, // 1 hour for OSM cameras (they don't change often)
} as const;

// Global rate limit settings
export const RATE_LIMITS = {
  WAZE_REQUESTS_PER_MINUTE: 60, // Max 30 requests to Waze per minute across all users
  OSM_REQUESTS_PER_MINUTE: 10, // Max 10 requests to OSM Overpass per minute
} as const;

