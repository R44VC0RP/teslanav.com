import { NextRequest, NextResponse } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";
import { redis, CACHE_KEYS, CACHE_TTL, RATE_LIMITS } from "@/lib/redis";

// Generate a cache key with tolerance for similar bounds (~1km precision)
function getCacheKey(left: string, right: string, bottom: string, top: string): string {
  // Round to 2 decimal places (~1km precision) to allow cache hits for nearby requests
  const roundTo = (n: string) => parseFloat(n).toFixed(2);
  return `${CACHE_KEYS.WAZE_ALERTS}${roundTo(left)},${roundTo(right)},${roundTo(bottom)},${roundTo(top)}`;
}

// Check and increment global rate limit
async function checkRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
  const key = CACHE_KEYS.WAZE_RATE_LIMIT;
  
  try {
    // Use Redis INCR with TTL for sliding window rate limiting
    const count = await redis.incr(key);
    
    // Set expiry on first request of the window
    if (count === 1) {
      await redis.expire(key, CACHE_TTL.RATE_LIMIT_WINDOW);
    }
    
    const remaining = Math.max(0, RATE_LIMITS.WAZE_REQUESTS_PER_MINUTE - count);
    return {
      allowed: count <= RATE_LIMITS.WAZE_REQUESTS_PER_MINUTE,
      remaining,
    };
  } catch (error) {
    // If Redis fails, allow the request but log it
    console.error("Redis rate limit check failed:", error);
    return { allowed: true, remaining: RATE_LIMITS.WAZE_REQUESTS_PER_MINUTE };
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const left = searchParams.get("left");
  const right = searchParams.get("right");
  const bottom = searchParams.get("bottom");
  const top = searchParams.get("top");

  if (!left || !right || !bottom || !top) {
    return NextResponse.json(
      { error: "Missing required bounds parameters" },
      { status: 400 }
    );
  }

  const cacheKey = getCacheKey(left, right, bottom, top);

  // Try to get from Redis cache first
  try {
    const cached = await redis.get<{ alerts: unknown[] }>(cacheKey);
    
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Cache": "HIT",
        },
      });
    }
  } catch (error) {
    // Log but continue if cache read fails
    console.error("Redis cache read failed:", error);
  }

  // Check global rate limit before making external request
  const { allowed, remaining } = await checkRateLimit();
  
  if (!allowed) {
    // Track rate limit hit
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: "server",
      event: "waze_global_rate_limited",
      properties: {
        bounds: { left, right, bottom, top },
      },
    });
    await posthog.shutdown();

    return NextResponse.json(
      { error: "Rate limited", alerts: [] },
      { 
        status: 429,
        headers: {
          "Retry-After": "60",
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  try {
    const wazeUrl = new URL("https://www.waze.com/live-map/api/georss");
    wazeUrl.searchParams.set("left", left);
    wazeUrl.searchParams.set("right", right);
    wazeUrl.searchParams.set("bottom", bottom);
    wazeUrl.searchParams.set("top", top);
    wazeUrl.searchParams.set("env", "na"); // North America
    wazeUrl.searchParams.set("types", "alerts");

    const response = await fetch(wazeUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TeslaNav/1.0)",
        "Accept": "application/json",
      },
      next: { revalidate: 60 },
    });

    // Handle Waze rate limiting
    if (response.status === 429) {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: "server",
        event: "waze_upstream_rate_limited",
        properties: {
          bounds: { left, right, bottom, top },
        },
      });
      await posthog.shutdown();

      return NextResponse.json(
        { error: "Rate limited", alerts: [] },
        { 
          status: 429,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (!response.ok) {
      throw new Error(`Waze API returned ${response.status}`);
    }

    const data = await response.json();

    // Store in Redis cache
    try {
      await redis.set(cacheKey, data, { ex: CACHE_TTL.WAZE_ALERTS });
    } catch (error) {
      console.error("Redis cache write failed:", error);
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-Cache": "MISS",
        "X-RateLimit-Remaining": remaining.toString(),
      },
    });
  } catch (error) {
    console.error("Waze API error:", error);

    // Track Waze API error
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: "server",
      event: "waze_api_error",
      properties: {
        error_message: error instanceof Error ? error.message : "Unknown error",
        bounds: { left, right, bottom, top },
      },
    });
    await posthog.shutdown();

    // Try to return stale cached data as fallback
    try {
      const stale = await redis.get<{ alerts: unknown[] }>(cacheKey);
      if (stale) {
        return NextResponse.json(stale, {
          headers: {
            "Cache-Control": "public, s-maxage=30",
            "X-Cache": "STALE",
          },
        });
      }
    } catch {
      // Ignore cache error on fallback
    }

    return NextResponse.json(
      { error: "Failed to fetch Waze data", alerts: [] },
      { status: 500 }
    );
  }
}
