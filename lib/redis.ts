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
  REVERSE_GEOCODE: "geocode:reverse:", // Format: geocode:reverse:{lat},{lng}
  // API Usage tracking (monthly)
  API_USAGE: "api:usage:", // Format: api:usage:{api_name}:{YYYY-MM}
  API_USAGE_DAILY: "api:usage:daily:", // Format: api:usage:daily:{api_name}:{YYYY-MM-DD}
  ALERT_SENT: "api:alert:", // Format: api:alert:{api_name}:{threshold}:{YYYY-MM}
  // Tile cache metadata (stores Vercel Blob URLs)
  TILE_CACHE: "tile:cache:", // Format: tile:cache:{encoded_url}
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  WAZE_ALERTS: 60, // 60 seconds for Waze alerts
  RATE_LIMIT_WINDOW: 60, // 1 minute window for rate limiting
  OSM_CAMERAS: 3600, // 1 hour for OSM cameras (they don't change often)
  REVERSE_GEOCODE: 86400, // 24 hours for reverse geocode (locations don't change)
  API_USAGE: 86400 * 35, // 35 days for monthly usage tracking
  API_USAGE_DAILY: 86400 * 7, // 7 days for daily usage
  TILE_CACHE: 86400 * 15, // 15 days for tile cache
} as const;

// Global rate limit settings
export const RATE_LIMITS = {
  WAZE_REQUESTS_PER_MINUTE: 60, // Max 30 requests to Waze per minute across all users
  OSM_REQUESTS_PER_MINUTE: 10, // Max 10 requests to OSM Overpass per minute
} as const;

// API free tier limits (LocationIQ: 5K/day = ~150K/month, Mapbox for maps/directions)
export const API_LIMITS = {
  GEOCODING: 150_000, // LocationIQ: 5K requests/day = ~150K/month
  REVERSE_GEOCODING: 150_000, // LocationIQ: 5K requests/day = ~150K/month
  MAP_LOADS: 50_000, // Mapbox: 50K map loads/month
  DIRECTIONS: 100_000, // Mapbox: 100K requests/month
} as const;

// Alias for backwards compatibility
export const MAPBOX_LIMITS = API_LIMITS;

// Alert thresholds (percentage of limit)
export const ALERT_THRESHOLDS = [50, 75, 90, 100] as const;

// API names for tracking
export type ApiName = "geocoding" | "reverse_geocoding" | "map_loads" | "directions";

/**
 * Get the current month key (YYYY-MM)
 */
export function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Get the current day key (YYYY-MM-DD)
 */
export function getDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Track an API call
 */
export async function trackApiUsage(apiName: ApiName, count: number = 1): Promise<number> {
  const monthKey = getMonthKey();
  const dayKey = getDayKey();
  
  const pipeline = redis.pipeline();
  
  // Increment monthly counter
  const monthlyKey = `${CACHE_KEYS.API_USAGE}${apiName}:${monthKey}`;
  pipeline.incrby(monthlyKey, count);
  pipeline.expire(monthlyKey, CACHE_TTL.API_USAGE);
  
  // Increment daily counter
  const dailyKey = `${CACHE_KEYS.API_USAGE_DAILY}${apiName}:${dayKey}`;
  pipeline.incrby(dailyKey, count);
  pipeline.expire(dailyKey, CACHE_TTL.API_USAGE_DAILY);
  
  const results = await pipeline.exec();
  return (results[0] as number) || 0;
}

/**
 * Get current month's usage for an API
 */
export async function getApiUsage(apiName: ApiName): Promise<number> {
  const monthKey = getMonthKey();
  const key = `${CACHE_KEYS.API_USAGE}${apiName}:${monthKey}`;
  const usage = await redis.get<number>(key);
  return usage || 0;
}

/**
 * Get usage for the last N days
 */
export async function getDailyUsage(apiName: ApiName, days: number = 7): Promise<{ date: string; count: number }[]> {
  const results: { date: string; count: number }[] = [];
  const pipeline = redis.pipeline();
  const dates: string[] = [];
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dates.push(dayKey);
    pipeline.get(`${CACHE_KEYS.API_USAGE_DAILY}${apiName}:${dayKey}`);
  }
  
  const counts = await pipeline.exec();
  
  for (let i = 0; i < days; i++) {
    results.push({
      date: dates[i],
      count: (counts[i] as number) || 0,
    });
  }
  
  return results.reverse(); // Return in chronological order
}

/**
 * Check if an alert has already been sent for a threshold this month
 */
export async function hasAlertBeenSent(apiName: ApiName, threshold: number): Promise<boolean> {
  const monthKey = getMonthKey();
  const key = `${CACHE_KEYS.ALERT_SENT}${apiName}:${threshold}:${monthKey}`;
  const sent = await redis.get<boolean>(key);
  return sent === true;
}

/**
 * Mark an alert as sent for this month
 */
export async function markAlertSent(apiName: ApiName, threshold: number): Promise<void> {
  const monthKey = getMonthKey();
  const key = `${CACHE_KEYS.ALERT_SENT}${apiName}:${threshold}:${monthKey}`;
  await redis.set(key, true, { ex: CACHE_TTL.API_USAGE });
}

