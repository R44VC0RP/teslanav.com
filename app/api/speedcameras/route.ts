import { NextRequest, NextResponse } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";
import { redis, CACHE_KEYS, CACHE_TTL, RATE_LIMITS } from "@/lib/redis";
import type { SpeedCamera, SpeedCameraResponse } from "@/types/speedcamera";
import type { SpeedLimitRoad, SpeedLimitValue } from "@/types/speedlimit";

// OSM Overpass API endpoint
const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Generate a cache key with tolerance for similar bounds (~5km precision for cameras)
function getCacheKey(left: string, right: string, bottom: string, top: string): string {
  // Round to 1 decimal place (~10km precision) since cameras don't change often
  const roundTo = (n: string) => parseFloat(n).toFixed(1);
  return `${CACHE_KEYS.OSM_CAMERAS}v2:${roundTo(left)},${roundTo(right)},${roundTo(bottom)},${roundTo(top)}`;
}

// Check and increment global rate limit
async function checkRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
  const key = CACHE_KEYS.OSM_RATE_LIMIT;
  
  try {
    const count = await redis.incr(key);
    
    if (count === 1) {
      await redis.expire(key, CACHE_TTL.RATE_LIMIT_WINDOW);
    }
    
    const remaining = Math.max(0, RATE_LIMITS.OSM_REQUESTS_PER_MINUTE - count);
    return {
      allowed: count <= RATE_LIMITS.OSM_REQUESTS_PER_MINUTE,
      remaining,
    };
  } catch (error) {
    console.error("Redis rate limit check failed:", error);
    return { allowed: true, remaining: RATE_LIMITS.OSM_REQUESTS_PER_MINUTE };
  }
}

// Build one Overpass query for cameras and posted road speed limits.
function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  // Query for:
  // - highway=speed_camera (dedicated speed cameras)
  // - enforcement=maxspeed (speed enforcement points)
  // - traffic_signals with red_light_camera
  const bbox = `${south},${west},${north},${east}`;
  
  return `
    [out:json][timeout:25];
    (
      // Speed cameras
      node["highway"="speed_camera"](${bbox});
      // Average speed cameras (section control)
      node["enforcement"="average_speed"](${bbox});
      // Red light cameras with speed enforcement
      node["highway"="traffic_signals"]["enforcement:maxspeed"="yes"](${bbox});
      node["highway"="traffic_signals"]["red_light_camera"="yes"](${bbox});
      // General enforcement nodes for maxspeed
      node["enforcement"="maxspeed"](${bbox});
      // Roads with a posted speed limit
      way["highway"]["maxspeed"](${bbox});
      way["highway"]["maxspeed:forward"](${bbox});
      way["highway"]["maxspeed:backward"](${bbox});
    );
    out body geom;
  `;
}

// Parse OSM element into SpeedCamera
function parseOsmElement(element: {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}): SpeedCamera {
  const tags = element.tags || {};
  
  // Determine camera type
  let type: SpeedCamera["type"] = "speed_camera";
  
  if (tags["enforcement"] === "average_speed") {
    type = "average_speed_camera";
  } else if (
    tags["red_light_camera"] === "yes" ||
    (tags["highway"] === "traffic_signals" && tags["enforcement:maxspeed"] === "yes")
  ) {
    type = "red_light_camera";
  }
  
  return {
    id: `osm-${element.id}`,
    type,
    location: {
      lat: element.lat,
      lon: element.lon,
    },
    maxspeed: tags["maxspeed"] || tags["enforcement:maxspeed:limit"],
    direction: tags["direction"] || tags["enforcement:direction"],
    name: tags["name"],
    ref: tags["ref"],
  };
}

function parseSpeedLimit(value: string | undefined): SpeedLimitValue | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!match) return null;

  const parsedValue = Number(match[1]);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return null;

  return {
    value: parsedValue,
    unit: match[2] === "mph" ? "mph" : "km/h",
  };
}

function parseSpeedLimitRoad(element: {
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}): SpeedLimitRoad | null {
  const tags = element.tags ?? {};
  const speedLimit = parseSpeedLimit(tags.maxspeed);
  const forwardSpeedLimit = parseSpeedLimit(tags["maxspeed:forward"]);
  const backwardSpeedLimit = parseSpeedLimit(tags["maxspeed:backward"]);
  const fallbackSpeedLimit = speedLimit ?? forwardSpeedLimit ?? backwardSpeedLimit;
  const coordinates = element.geometry?.map(({ lon, lat }) => [lon, lat] as [number, number]) ?? [];

  if (!fallbackSpeedLimit || coordinates.length < 2) return null;

  return {
    id: `osm-way-${element.id}`,
    coordinates,
    speedLimit: fallbackSpeedLimit,
    ...(forwardSpeedLimit ? { forwardSpeedLimit } : {}),
    ...(backwardSpeedLimit ? { backwardSpeedLimit } : {}),
  };
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
    const cached = await redis.get<SpeedCameraResponse>(cacheKey);
    
    if (cached) {
      const cameraCount = cached.cameras?.length || 0;
      console.log(`[SpeedCameras] Cache HIT - ${cameraCount} cameras`);
      return NextResponse.json({ ...cached, speedLimits: cached.speedLimits ?? [] }, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
          "X-Cache": "HIT",
        },
      });
    }
  } catch (error) {
    console.error("Redis cache read failed:", error);
  }

  // Check global rate limit
  const { allowed, remaining } = await checkRateLimit();
  
  if (!allowed) {
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: "server",
      event: "osm_global_rate_limited",
      properties: {
        bounds: { left, right, bottom, top },
      },
    });
    await posthog.shutdown();

    return NextResponse.json(
      { error: "Rate limited", cameras: [], speedLimits: [] },
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
    const query = buildOverpassQuery(
      parseFloat(bottom),
      parseFloat(left),
      parseFloat(top),
      parseFloat(right)
    );

    console.log(`[SpeedCameras] Query bbox: south=${bottom}, west=${left}, north=${top}, east=${right}`);

    const response = await fetch(OVERPASS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "TeslaNav/1.0 (https://teslanav.com)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.status === 429) {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: "server",
        event: "osm_upstream_rate_limited",
        properties: {
          bounds: { left, right, bottom, top },
        },
      });
      await posthog.shutdown();

      return NextResponse.json(
        { error: "Rate limited", cameras: [], speedLimits: [] },
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
      throw new Error(`Overpass API returned ${response.status}`);
    }

    const data: {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        geometry?: Array<{ lat: number; lon: number }>;
        tags?: Record<string, string>;
      }>;
    } = await response.json();
    const elements = data.elements ?? [];
    
    // Parse OSM elements into SpeedCamera objects
    const cameras: SpeedCamera[] = elements
      .filter((element): element is typeof element & { lat: number; lon: number } =>
        element.type === "node" && element.lat !== undefined && element.lon !== undefined
      )
      .map(parseOsmElement);
    const speedLimits = elements
      .filter((element) => element.type === "way")
      .map(parseSpeedLimitRoad)
      .filter((road): road is SpeedLimitRoad => road !== null);

    // Count by type for logging
    const speedCams = cameras.filter(c => c.type === "speed_camera").length;
    const redLightCams = cameras.filter(c => c.type === "red_light_camera").length;
    const avgSpeedCams = cameras.filter(c => c.type === "average_speed_camera").length;
    console.log(`[SpeedCameras] Cache MISS - Fetched ${cameras.length} cameras and ${speedLimits.length} speed limits from OSM (speed: ${speedCams}, red light: ${redLightCams}, avg speed: ${avgSpeedCams})`);

    const result: SpeedCameraResponse = {
      cameras,
      speedLimits,
      timestamp: Date.now(),
      source: "osm",
    };

    // Store in Redis cache with longer TTL (cameras don't change often)
    try {
      await redis.set(cacheKey, result, { ex: CACHE_TTL.OSM_CAMERAS });
    } catch (error) {
      console.error("Redis cache write failed:", error);
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        "X-Cache": "MISS",
        "X-RateLimit-Remaining": remaining.toString(),
      },
    });
  } catch (error) {
    console.error("Overpass API error:", error);

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: "server",
      event: "osm_api_error",
      properties: {
        error_message: error instanceof Error ? error.message : "Unknown error",
        bounds: { left, right, bottom, top },
      },
    });
    await posthog.shutdown();

    // Try to return stale cached data as fallback
    try {
      const stale = await redis.get<SpeedCameraResponse>(cacheKey);
      if (stale) {
        return NextResponse.json({ ...stale, speedLimits: stale.speedLimits ?? [] }, {
          headers: {
            "Cache-Control": "public, s-maxage=300",
            "X-Cache": "STALE",
          },
        });
      }
    } catch {
      // Ignore cache error on fallback
    }

    return NextResponse.json(
      { error: "Failed to fetch speed camera data", cameras: [], speedLimits: [] },
      { status: 500 }
    );
  }
}

