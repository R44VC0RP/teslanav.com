import { redis, CACHE_KEYS, CACHE_TTL } from "./redis";
import { Supercharger, SuperchargerAvailability, SuperchargerPricing } from "@/types/supercharger";
import crypto from "crypto";

/**
 * Store supercharger in cache
 */
export async function cacheSupercharger(supercharger: Supercharger): Promise<void> {
  const key = `${CACHE_KEYS.SUPERCHARGER}${supercharger.id}`;
  await redis.set(key, JSON.stringify(supercharger), {
    ex: CACHE_TTL.SUPERCHARGER_METADATA,
  });

  // Add to locations set
  await redis.sadd(CACHE_KEYS.SUPERCHARGER_LOCATIONS, supercharger.id);
}

/**
 * Get supercharger from cache
 */
export async function getSuperchargerFromCache(id: string): Promise<Supercharger | null> {
  const key = `${CACHE_KEYS.SUPERCHARGER}${id}`;
  const data = await redis.get<string>(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Cache superchargers in a bounding box
 */
export async function cacheSuperchargersByBounds(
  superchargers: Supercharger[],
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
): Promise<string> {
  // Create a hash of the bounds
  const boundsKey = JSON.stringify(bounds);
  const hash = crypto.createHash("md5").update(boundsKey).digest("hex");

  const key = `${CACHE_KEYS.SUPERCHARGER_BOUNDS}${hash}`;
  const data = {
    bounds,
    superchargers: superchargers.map((s) => s.id),
    timestamp: Date.now(),
  };

  await redis.set(key, JSON.stringify(data), {
    ex: CACHE_TTL.SUPERCHARGER_METADATA,
  });

  return hash;
}

/**
 * Get superchargers by bounds from cache
 */
export async function getSuperchargersByBoundsFromCache(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
): Promise<Supercharger[] | null> {
  const boundsKey = JSON.stringify(bounds);
  const hash = crypto.createHash("md5").update(boundsKey).digest("hex");

  const key = `${CACHE_KEYS.SUPERCHARGER_BOUNDS}${hash}`;
  const data = await redis.get<string>(key);
  if (!data) return null;

  const cached = JSON.parse(data);
  const superchargers: Supercharger[] = [];

  for (const id of cached.superchargers) {
    const sc = await getSuperchargerFromCache(id);
    if (sc) superchargers.push(sc);
  }

  return superchargers;
}

/**
 * Cache supercharger availability
 */
export async function cacheAvailability(
  id: string,
  availability: SuperchargerAvailability
): Promise<void> {
  const key = `${CACHE_KEYS.SUPERCHARGER_AVAILABILITY}${id}`;
  await redis.set(key, JSON.stringify(availability), {
    ex: CACHE_TTL.SUPERCHARGER_AVAILABILITY,
  });
}

/**
 * Get supercharger availability from cache
 */
export async function getAvailabilityFromCache(id: string): Promise<SuperchargerAvailability | null> {
  const key = `${CACHE_KEYS.SUPERCHARGER_AVAILABILITY}${id}`;
  const data = await redis.get<string>(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Cache supercharger pricing
 */
export async function cachePricing(
  id: string,
  pricing: SuperchargerPricing
): Promise<void> {
  const key = `${CACHE_KEYS.SUPERCHARGER_PRICING}${id}`;
  await redis.set(key, JSON.stringify(pricing), {
    ex: CACHE_TTL.SUPERCHARGER_PRICING,
  });
}

/**
 * Get supercharger pricing from cache
 */
export async function getPricingFromCache(id: string): Promise<SuperchargerPricing | null> {
  const key = `${CACHE_KEYS.SUPERCHARGER_PRICING}${id}`;
  const data = await redis.get<string>(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Clear all supercharger cache
 */
export async function clearAllSuperchargerCache(): Promise<void> {
  const keys = await redis.keys(`${CACHE_KEYS.SUPERCHARGER}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
