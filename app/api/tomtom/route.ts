import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { redis, CACHE_KEYS, CACHE_TTL } from "@/lib/redis";
import type { TrafficIncident } from "@/types/traffic";

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const clientIp = request.headers.get("x-client-ip");
  return clientIp || "unknown";
}

function getCacheKey(bounds: string): string {
  const hash = createHash("sha256").update(bounds).digest("hex").slice(0, 16);
  return `${CACHE_KEYS.TOMTOM_TRAFFIC}${hash}`;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    console.error("TOMTOM_API_KEY environment variable not set");
    return NextResponse.json(
      { error: "API configuration error", incidents: [] },
      { status: 500 }
    );
  }

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
    const cached = await redis.get<{ incidents: TrafficIncident[] }>(cacheKey);
    if (cached) {
      console.log(`[TomTom Traffic] Cache HIT - ${cached.incidents?.length || 0} incidents`);
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Cache": "HIT",
        },
      });
    }
  } catch (error) {
    console.error("Redis cache read failed:", error);
  }

  try {
    // TomTom format: bbox=minLon,minLat,maxLon,maxLat
    const bbox = `${leftNum},${bottomNum},${rightNum},${topNum}`;

    const url = new URL("https://api.tomtom.com/traffic/services/4/incidentDetails");
    url.searchParams.set("bbox", bbox);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("language", "en");

    console.log("[TomTom Traffic] Fetching incidents");
    console.log("[TomTom Traffic] URL:", url.toString().replace(apiKey, "***"));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      console.log("[TomTom Traffic] Response status:", response.status);

      if (response.status === 401) {
        console.error("TomTom API authentication failed (401)");
        return NextResponse.json(
          { error: "API authentication error", incidents: [] },
          { status: 500 }
        );
      }

      if (response.status === 403) {
        console.error("TomTom API access forbidden (403)");
        return NextResponse.json(
          { error: "API access forbidden", incidents: [] },
          { status: 403 }
        );
      }

      if (!response.ok) {
        throw new Error(`TomTom API error: ${response.status}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        // TomTom might return XML, handle gracefully
        console.log("[TomTom Traffic] Response is not JSON, returning empty");
        const data = { incidents: [] as TrafficIncident[] };

        try {
          await redis.set(cacheKey, data, { ex: CACHE_TTL.TOMTOM_TRAFFIC });
        } catch (error) {
          console.error("Redis cache write failed:", error);
        }

        return NextResponse.json(data, {
          headers: {
            "Cache-Control": "public, s-maxage=60",
            "X-Cache": "MISS",
          },
        });
      }

      const rawData = await response.json();

      // Parse TomTom response and convert to our format
      const incidents = parseTomTomIncidents(rawData);

      const data = { incidents };

      // Cache the results
      try {
        await redis.set(cacheKey, data, { ex: CACHE_TTL.TOMTOM_TRAFFIC });
      } catch (error) {
        console.error("Redis cache write failed:", error);
      }

      console.log(`[TomTom Traffic] Cache MISS - Fetched ${incidents.length} incidents`);

      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Cache": "MISS",
        },
      });
    } catch (fetchError) {
      console.error("TomTom Traffic API error:", fetchError);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          { error: "Request timeout", incidents: [] },
          { status: 504 }
        );
      }

      // Try to return stale cached data as fallback
      try {
        const stale = await redis.get<{ incidents: TrafficIncident[] }>(cacheKey);
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
        { error: "Failed to fetch traffic data", incidents: [] },
        { status: 500 }
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("Unexpected error in TomTom Traffic API:", error);
    return NextResponse.json(
      { error: "Internal server error", incidents: [] },
      { status: 500 }
    );
  }
}

// Parse TomTom API response into our TrafficIncident format
function parseTomTomIncidents(data: any): TrafficIncident[] {
  const incidents: TrafficIncident[] = [];

  try {
    // TomTom response structure varies, try common paths
    const incidentList = data.incidents || data.results || [];

    if (Array.isArray(incidentList)) {
      for (const incident of incidentList) {
        try {
          const item: TrafficIncident = {
            id: incident.incidentId || `tomtom-${Math.random()}`,
            type: mapTomTomIncidentType(incident.incidentType),
            severity: mapTomTomSeverity(incident.delaySeconds || 0),
            latitude: incident.lat || incident.position?.latitude || 0,
            longitude: incident.lng || incident.position?.longitude || 0,
            description: incident.description || incident.title || "Traffic incident",
            delay: incident.delaySeconds || undefined,
            length: incident.length || undefined,
            timestamp: incident.startTime ? new Date(incident.startTime).getTime() : Date.now(),
            endTime: incident.endTime ? new Date(incident.endTime).getTime() : undefined,
          };

          // Only add valid incidents
          if (item.latitude !== 0 && item.longitude !== 0) {
            incidents.push(item);
          }
        } catch (e) {
          console.warn("Failed to parse incident:", e);
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse TomTom incidents:", error);
  }

  return incidents;
}

function mapTomTomIncidentType(
  tomtomType: string
): 'ACCIDENT' | 'JAM' | 'ROAD_CLOSED' | 'CONSTRUCTION' | 'DISABLED_VEHICLE' | 'OTHER' {
  const typeMap: Record<string, any> = {
    accident: 'ACCIDENT',
    congestion: 'JAM',
    roadworks: 'CONSTRUCTION',
    'road closed': 'ROAD_CLOSED',
    'road closure': 'ROAD_CLOSED',
    'disabled vehicle': 'DISABLED_VEHICLE',
    jam: 'JAM',
  };

  const normalized = (tomtomType || '').toLowerCase();
  return typeMap[normalized] || 'OTHER';
}

function mapTomTomSeverity(delaySeconds: number): 'CRITICAL' | 'MAJOR' | 'MINOR' | 'LOW' {
  if (delaySeconds > 600) return 'CRITICAL'; // > 10 min
  if (delaySeconds > 300) return 'MAJOR'; // > 5 min
  if (delaySeconds > 60) return 'MINOR'; // > 1 min
  return 'LOW';
}
