import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { redis, CACHE_KEYS, CACHE_TTL } from "@/lib/redis";
import type { TrafficSegment } from "@/types/traffic";

const REQUEST_TIMEOUT_MS = 15000;

function getCacheKey(bounds: string): string {
  const hash = createHash("sha256").update(bounds).digest("hex").slice(0, 16);
  return `${CACHE_KEYS.OPENTRAFFIC_SEGMENTS}${hash}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const left = searchParams.get("left");
  const right = searchParams.get("right");
  const bottom = searchParams.get("bottom");
  const top = searchParams.get("top");

  if (!left || !right || !bottom || !top) {
    return NextResponse.json(
      { error: "Missing required bounds parameters (left, right, bottom, top)" },
      { status: 400 }
    );
  }

  // Validate bounds are valid numbers
  const leftNum = parseFloat(left);
  const rightNum = parseFloat(right);
  const bottomNum = parseFloat(bottom);
  const topNum = parseFloat(top);

  if (isNaN(leftNum) || isNaN(rightNum) || isNaN(bottomNum) || isNaN(topNum)) {
    return NextResponse.json(
      { error: "Invalid bounds: must be valid numbers" },
      { status: 400 }
    );
  }

  const boundsKey = `${left},${right},${bottom},${top}`;
  const cacheKey = getCacheKey(boundsKey);

  // Check cache first
  try {
    const cached = await redis.get<{ segments: TrafficSegment[] }>(cacheKey);
    if (cached) {
      console.log(`[OpenTraffic] Cache HIT - ${cached.segments?.length || 0} segments`);
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
          "X-Cache": "HIT",
        },
      });
    }
  } catch (error) {
    console.error("Redis cache read failed:", error);
  }

  try {
    console.log("[OpenTraffic] Fetching traffic segments");

    // OpenTraffic data: Generate realistic traffic segments based on bounds
    // In a real implementation, this would query OpenTraffic's data API or static tiles
    // For now, we'll create simulated segments for demonstration
    const segments = generateTrafficSegments(leftNum, rightNum, bottomNum, topNum);

    const data = { segments };

    // Cache the results
    try {
      await redis.set(cacheKey, data, { ex: CACHE_TTL.OPENTRAFFIC_SEGMENTS });
    } catch (error) {
      console.error("Redis cache write failed:", error);
    }

    console.log(`[OpenTraffic] Cache MISS - Generated ${segments.length} segments`);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Unexpected error in OpenTraffic API:", error);

    // Try to return stale cached data as fallback
    try {
      const stale = await redis.get<{ segments: TrafficSegment[] }>(cacheKey);
      if (stale) {
        return NextResponse.json(stale, {
          headers: {
            "Cache-Control": "public, s-maxage=60",
            "X-Cache": "STALE",
          },
        });
      }
    } catch {
      // Ignore cache error on fallback
    }

    return NextResponse.json(
      { error: "Failed to fetch traffic data", segments: [] },
      { status: 500 }
    );
  }
}

/**
 * Generate realistic traffic segments for the given bounds
 * In production, this would query actual OpenTraffic data
 */
function generateTrafficSegments(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number
): TrafficSegment[] {
  const segments: TrafficSegment[] = [];

  // Create a grid of segments across the bounds
  const segmentSize = 0.01; // ~1km at equator
  const speedVariation = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]; // km/h

  let segmentId = 0;

  for (let lon = minLon; lon < maxLon; lon += segmentSize) {
    for (let lat = minLat; lat < maxLat; lat += segmentSize) {
      // Only generate segments for ~30% of grid (more realistic sparse coverage)
      if (Math.random() > 0.7) {
        continue;
      }

      // Vary speed based on location (highway vs local roads)
      const isHighway = Math.random() > 0.6;
      const baseSpeed = isHighway ? 80 : 45;
      const speedVariationAmount = speedVariation[Math.floor(Math.random() * speedVariation.length)];

      segments.push({
        id: `opentraffic-${segmentId++}`,
        latitude: lat + Math.random() * segmentSize / 2,
        longitude: lon + Math.random() * segmentSize / 2,
        averageSpeed: baseSpeed + (Math.random() - 0.5) * 20,
        speedLimit: isHighway ? 100 : 50,
        timestamp: Date.now(),
      });
    }
  }

  return segments;
}
