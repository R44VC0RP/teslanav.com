import { getRedisClient } from "@/lib/redis";

/**
 * Waze relay plumbing.
 *
 * Waze's georss API requires a reCAPTCHA Enterprise token generated on the
 * www.waze.com origin PLUS the session cookies of the browser that minted it
 * (verified July 2026). Those cookies are httpOnly, so they can't leave the
 * browser. Therefore a userscript running on waze.com performs the georss
 * fetch in-page and relays the resulting alert JSON to us:
 *
 *   Tesla client -> GET /api/waze (records pending bounds)
 *   userscript   -> GET /api/waze/relay          (reads pending bounds)
 *   userscript   -> fetch georss on waze.com     (fresh token, own cookies)
 *   userscript   -> POST /api/waze/relay         (alerts cached in Redis)
 *   Tesla client -> GET /api/waze                (served from Redis cache)
 */

const PENDING_KEY = "waze:relay:pending";
const PENDING_TTL_SECONDS = 120;
export const ALERTS_CACHE_TTL_SECONDS = 60;

export interface RelayBounds {
  left: string;
  right: string;
  bottom: string;
  top: string;
}

interface PendingBounds extends RelayBounds {
  requestedAt: number;
}

/**
 * Cache key with tolerance for similar bounds (~1km precision).
 * Shared by the client-facing route and the relay result route so their
 * keys line up.
 */
export function getAlertsCacheKey(
  left: string,
  right: string,
  bottom: string,
  top: string
): string {
  const roundTo = (n: string) => parseFloat(n).toFixed(2);
  return `waze:alerts:${roundTo(left)},${roundTo(right)},${roundTo(bottom)},${roundTo(top)}`;
}

export async function setPendingBounds(bounds: RelayBounds): Promise<void> {
  const pending: PendingBounds = { ...bounds, requestedAt: Date.now() };
  await getRedisClient().set(
    PENDING_KEY,
    JSON.stringify(pending),
    "EX",
    PENDING_TTL_SECONDS
  );
}

export async function getPendingBounds(): Promise<PendingBounds | null> {
  try {
    const raw = await getRedisClient().get(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingBounds;
  } catch {
    return null;
  }
}

export async function cacheAlerts(
  cacheKey: string,
  data: unknown,
  ttlSeconds: number = ALERTS_CACHE_TTL_SECONDS
): Promise<void> {
  await getRedisClient().set(
    cacheKey,
    JSON.stringify(data),
    "EX",
    ttlSeconds
  );
}

export async function getCachedAlerts<T = unknown>(
  cacheKey: string
): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(cacheKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function isRelayAuthorized(authHeader: string | null): boolean {
  const secret = process.env.WAZE_RELAY_SECRET;
  // If no secret is configured the relay is disabled entirely - we never
  // want an open endpoint accepting data from anyone.
  if (!secret) return false;
  return authHeader === `Bearer ${secret}`;
}
