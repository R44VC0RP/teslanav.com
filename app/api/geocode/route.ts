import { NextRequest, NextResponse } from "next/server";
import { trackApiUsage } from "@/lib/redis";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

/**
 * GET /api/geocode?q=query&proximity=lng,lat
 * Uses Mapbox Geocoding API v6 (100K free requests/month vs 12K sessions for Search Box)
 * Returns results WITH coordinates - no second API call needed!
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const proximity = searchParams.get("proximity");

  if (!query) {
    return NextResponse.json(
      { error: "Missing search query" },
      { status: 400 }
    );
  }

  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { error: "Mapbox token not configured" },
      { status: 500 }
    );
  }

  try {
    // Use Mapbox Geocoding API v6 - 100K free requests/month!
    const baseUrl = "https://api.mapbox.com/search/geocode/v6/forward";
    
    const params = new URLSearchParams({
      q: query,
      access_token: MAPBOX_TOKEN,
      limit: "5",
      language: "en",
      country: "US",
      types: "poi,address,place,street",
      autocomplete: "true", // Enable prefix matching for better UX
    });

    if (proximity) {
      params.set("proximity", proximity);
    }

    const response = await fetch(`${baseUrl}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();

    // Track API usage (fire and forget - don't block response)
    trackApiUsage("geocoding").catch(console.error);

    // Geocoding API v6 returns coordinates directly - no second call needed!
    const features = (data.features || []).map((feature: {
      id: string;
      geometry: { coordinates: [number, number] };
      properties: {
        name: string;
        full_address?: string;
        place_formatted?: string;
        context?: {
          address?: { name: string };
          street?: { name: string };
          place?: { name: string };
          region?: { name: string };
        };
      };
    }) => ({
      id: feature.id,
      place_name: feature.properties.full_address || feature.properties.place_formatted || feature.properties.name,
      text: feature.properties.name,
      center: feature.geometry.coordinates, // Coordinates included directly!
    }));

    return NextResponse.json({ features });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 500 }
    );
  }
}

