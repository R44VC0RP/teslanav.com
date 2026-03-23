import { NextRequest, NextResponse } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";
import { redis, CACHE_KEYS, CACHE_TTL, RATE_LIMITS } from "@/lib/redis";
import {
  convertBoundsToOpenWebNinja,
  mapOpenWebNinjaResponse,
  type OpenWebNinjaResponse,
} from "@/lib/openweb-ninja";

// Generate a cache key with tolerance for similar bounds (~1km precision)
function getCacheKey(
  left: string,
  right: string,
  bottom: string,
  top: string,
  includeJams: boolean = false
): string {
  // Round to 2 decimal places (~1km precision) to allow cache hits for nearby requests
  const roundTo = (n: string) => parseFloat(n).toFixed(2);
  const jamsSuffix = includeJams ? ":jams" : "";
  return `${CACHE_KEYS.WAZE_ALERTS}${roundTo(left)},${roundTo(right)},${roundTo(bottom)},${roundTo(top)}${jamsSuffix}`;
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
  // Validate API key
  const apiKey = process.env.OPENWEB_NINJA_API_KEY;
  if (!apiKey) {
    console.error("OPENWEB_NINJA_API_KEY environment variable not set");
    return NextResponse.json(
      { error: "API configuration error", alerts: [] },
      { status: 500 }
    );
  }

  const searchParams = request.nextUrl.searchParams;

  const left = searchParams.get("left");
  const right = searchParams.get("right");
  const bottom = searchParams.get("bottom");
  const top = searchParams.get("top");
  const includeJams = searchParams.get("jams") === "true";

  if (!left || !right || !bottom || !top) {
    return NextResponse.json(
      { error: "Missing required bounds parameters" },
      { status: 400 }
    );
  }

  const cacheKey = getCacheKey(left, right, bottom, top, includeJams);

  // Try to get from Redis cache first
  try {
    const cached = await redis.get<{ alerts: unknown[] }>(cacheKey);

    if (cached) {
      const alertCount = cached.alerts?.length || 0;
      console.log(`[OpenWeb Ninja Waze] Cache HIT - ${alertCount} alerts`);
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
        provider: "openweb_ninja",
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
    // Convert bounds format from teslanav to OpenWeb Ninja format
    const leftNum = parseFloat(left);
    const rightNum = parseFloat(right);
    const bottomNum = parseFloat(bottom);
    const topNum = parseFloat(top);

    const { bottom_left, top_right } = convertBoundsToOpenWebNinja({
      left: leftNum,
      right: rightNum,
      bottom: bottomNum,
      top: topNum,
    });

    // Build OpenWeb Ninja API request
    const url = new URL("https://api.openweb.ninja/api/waze/alerts-and-jams");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("bottom_left", bottom_left);
    url.searchParams.set("top_right", top_right);
    url.searchParams.set("max_alerts", "500");
    url.searchParams.set("max_jams", includeJams ? "100" : "0");

    console.log(
      `[OpenWeb Ninja Waze] Fetching with bounds: ${bottom_left} to ${top_right}`
    );

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    // Handle OpenWeb Ninja rate limiting
    if (response.status === 429 || response.status === 403) {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: "server",
        event: "openweb_ninja_upstream_rate_limited",
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

    // Handle API authentication errors
    if (response.status === 401) {
      console.error("OpenWeb Ninja API authentication failed (401)");
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: "server",
        event: "openweb_ninja_auth_error",
        properties: {
          status: 401,
        },
      });
      await posthog.shutdown();

      return NextResponse.json(
        { error: "API configuration error", alerts: [] },
        { status: 500 }
      );
    }

    if (!response.ok) {
      const statusText = response.statusText;
      throw new Error(
        `OpenWeb Ninja API returned ${response.status} ${statusText}`
      );
    }

    const rawData = await response.json();

    // Map OpenWeb Ninja response to WazeResponse format
    let data = { alerts: [] as unknown[] };
    try {
      const openwebData = rawData as OpenWebNinjaResponse;
      data = mapOpenWebNinjaResponse(openwebData, includeJams);
    } catch (mapError) {
      console.error("Failed to map OpenWeb Ninja response:", mapError);
      // If mapping fails, try to extract alerts directly as fallback
      if (Array.isArray(rawData.alerts)) {
        data = { alerts: rawData.alerts };
      }
    }

    const alertCount = data.alerts?.length || 0;
    console.log(
      `[OpenWeb Ninja Waze] Cache MISS - Fetched ${alertCount} alerts`
    );

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
    console.error("OpenWeb Ninja Waze API error:", error);

    // Track OpenWeb Ninja API error
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: "server",
      event: "openweb_ninja_api_error",
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
