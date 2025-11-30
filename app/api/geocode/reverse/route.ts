import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Cache reverse geocode results for 24 hours (locations don't change)
const CACHE_TTL = 86400; // 24 hours in seconds

// Round coordinates to create cache key (2 decimal places = ~1.1km grid)
function getCacheKey(lng: number, lat: number): string {
  const roundedLng = Math.round(lng * 100) / 100;
  const roundedLat = Math.round(lat * 100) / 100;
  return `geocode:reverse:${roundedLat},${roundedLng}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lng = searchParams.get("lng");
  const lat = searchParams.get("lat");

  if (!lng || !lat) {
    return NextResponse.json(
      { error: "Missing coordinates" },
      { status: 400 }
    );
  }

  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { error: "Mapbox token not configured" },
      { status: 500 }
    );
  }

  const lngNum = parseFloat(lng);
  const latNum = parseFloat(lat);
  const cacheKey = getCacheKey(lngNum, latNum);

  try {
    // Check cache first
    const cached = await redis.get<string>(cacheKey);
    if (cached) {
      return NextResponse.json({ placeName: cached, cached: true });
    }

    // Not cached - fetch from Mapbox
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place,locality,neighborhood&limit=1`
    );

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();
    
    const placeName = data.features?.[0]?.place_name || 
                      data.features?.[0]?.text ||
                      `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}`;

    // Cache the result
    await redis.set(cacheKey, placeName, { ex: CACHE_TTL });

    return NextResponse.json({ placeName });
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return NextResponse.json(
      { error: "Reverse geocoding request failed" },
      { status: 500 }
    );
  }
}

