import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getPostHogClient } from "@/lib/posthog-server";
import { redis, CACHE_KEYS, CACHE_TTL, RATE_LIMITS } from "@/lib/redis";
import {
  convertBoundsToOpenWebNinja,
  mapOpenWebNinjaResponse,
  type OpenWebNinjaResponse,
} from "@/lib/openweb-ninja";

// Configuration constants
const REQUEST_TIMEOUT_MS = 15000; // 15 second timeout for external API
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB max response
const MAX_QUERY_STRING_SIZE = 2048; // Max query string length

// Helper: Generate cache key using hash (prevents key injection)
function getCacheKey(
  left: string,
  right: string,
  bottom: string,
  top: string,
  includeJams: boolean = false
): string {
  // Use hash to prevent key injection attacks
  const boundString = `${left},${right},${bottom},${top}`;
  const hash = createHash("sha256").update(boundString).digest("hex").slice(0, 16);
  const jamsSuffix = includeJams ? ":jams" : "";
  return `${CACHE_KEYS.WAZE_ALERTS}${hash}${jamsSuffix}`;
}

export async function GET(request: NextRequest) {
  // SECURITY: Validate API key exists
  const apiKey = process.env.OPENWEB_NINJA_API_KEY;
  if (!apiKey) {
    console.error("OPENWEB_NINJA_API_KEY environment variable not set");
    return NextResponse.json(
      { error: "API configuration error - API key not found", alerts: [] },
      { status: 500 }
    );
  }

  // SECURITY: Validate query string size
  const queryString = request.nextUrl.search;
  if (queryString.length > MAX_QUERY_STRING_SIZE) {
    return NextResponse.json(
      { error: "Request too large" },
      { status: 413 }
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

  try {
    // Convert bounds format from teslanav to OpenWeb Ninja format
    const leftNum = parseFloat(left);
    const rightNum = parseFloat(right);
    const bottomNum = parseFloat(bottom);
    const topNum = parseFloat(top);

    // Validate bounds are valid numbers within lat/lng ranges
    if (
      isNaN(leftNum) ||
      isNaN(rightNum) ||
      isNaN(bottomNum) ||
      isNaN(topNum)
    ) {
      return NextResponse.json(
        { error: "Invalid bounds parameters: must be valid numbers" },
        { status: 400 }
      );
    }

    // Validate longitude range (-180 to 180)
    if (leftNum < -180 || leftNum > 180 || rightNum < -180 || rightNum > 180) {
      return NextResponse.json(
        { error: "Invalid bounds: longitude must be between -180 and 180" },
        { status: 400 }
      );
    }

    // Validate latitude range (-90 to 90)
    if (
      bottomNum < -90 ||
      bottomNum > 90 ||
      topNum < -90 ||
      topNum > 90
    ) {
      return NextResponse.json(
        { error: "Invalid bounds: latitude must be between -90 and 90" },
        { status: 400 }
      );
    }

    // Validate that left < right and bottom < top
    if (leftNum >= rightNum) {
      return NextResponse.json(
        { error: "Invalid bounds: left must be less than right" },
        { status: 400 }
      );
    }

    if (bottomNum >= topNum) {
      return NextResponse.json(
        { error: "Invalid bounds: bottom must be less than top" },
        { status: 400 }
      );
    }

    const { bottom_left, top_right } = convertBoundsToOpenWebNinja({
      left: leftNum,
      right: rightNum,
      bottom: bottomNum,
      top: topNum,
    });

    // Build OpenWeb Ninja API request
    const url = new URL("https://api.openwebninja.com/waze/alerts-and-jams");
    url.searchParams.set("bottom_left", bottom_left);
    url.searchParams.set("top_right", top_right);
    url.searchParams.set("max_alerts", "500");
    url.searchParams.set("max_jams", includeJams ? "100" : "0");

    // SECURITY: Log sanitized info (no exposing full bounds in logs)
    console.log("[OpenWeb Ninja Waze] Fetching alerts data");
    console.log("[OpenWeb Ninja Waze] URL:", url.toString().replace(apiKey, "***"));

    // SECURITY: Create abort controller with timeout
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
      });

      console.log("[OpenWeb Ninja Waze] Response status:", response.status);

      // SECURITY: Validate Content-Type header
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        throw new Error(
          "Invalid response: expected application/json"
        );
      }

      // SECURITY: Validate Content-Length header before downloading
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error(
            `Response too large: ${size} bytes exceeds ${MAX_RESPONSE_SIZE_BYTES}`
          );
        }
      }

      // Handle OpenWeb Ninja rate limiting
      if (response.status === 429 || response.status === 403) {
        const posthog = getPostHogClient();
        posthog.capture({
          distinctId: "server",
          event: "openweb_ninja_upstream_rate_limited",
          properties: { reason: "upstream_rate_limit" },
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
        try {
          const errorBody = await response.json();
          console.error("OpenWeb Ninja API authentication failed (401):", errorBody);
        } catch {
          const errorText = await response.text();
          console.error("OpenWeb Ninja API authentication failed (401):", errorText);
        }
        const posthog = getPostHogClient();
        posthog.capture({
          distinctId: "server",
          event: "openweb_ninja_auth_error",
          properties: { status: 401 },
        });
        await posthog.shutdown();

        return NextResponse.json(
          { error: "API configuration error", alerts: [] },
          { status: 500 }
        );
      }

      if (!response.ok) {
        // Don't expose raw error details from upstream API
        throw new Error(`OpenWeb Ninja API error: ${response.status}`);
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
          "X-RateLimit-Remaining": "0", // FIXME: Proper rate limiting requires Redis implementation
        },
      });
    } catch (fetchError) {
      console.error("OpenWeb Ninja Waze API error:", fetchError);

      // SECURITY: Handle timeout errors
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          { error: "Request timeout", alerts: [] },
          { status: 504 }
        );
      }

      // Track OpenWeb Ninja API error (log full error server-side, but don't expose to client)
      const posthog = getPostHogClient();
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Unknown error";
      posthog.capture({
        distinctId: "server",
        event: "openweb_ninja_api_error",
        properties: { error_message: errorMessage },
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
    } finally {
      // SECURITY: Always clear the timeout
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("Unexpected error in Waze API:", error);
    return NextResponse.json(
      { error: "Internal server error", alerts: [] },
      { status: 500 }
    );
  }
}
