import { NextRequest, NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Session token for Search Box API (improves billing - groups suggest + retrieve calls)
let sessionToken = crypto.randomUUID();

/**
 * GET /api/geocode?q=query&proximity=lng,lat
 * Returns search suggestions WITHOUT coordinates (saves 10 API calls per search!)
 * Coordinates are fetched lazily when user selects a result via POST
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
    // Use Mapbox Search Box API - only get suggestions (1 API call)
    const baseUrl = "https://api.mapbox.com/search/searchbox/v1/suggest";
    
    const params = new URLSearchParams({
      q: query,
      access_token: MAPBOX_TOKEN,
      session_token: sessionToken,
      limit: "5", // Only get 5 since we return 5
      language: "en",
      country: "US",
      types: "poi,address,place,street",
    });

    if (proximity) {
      params.set("proximity", proximity);
    }

    const response = await fetch(`${baseUrl}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();

    // Return suggestions WITHOUT fetching coordinates (saves ~10 API calls!)
    // Coordinates will be fetched via POST when user selects a result
    const features = (data.suggestions || []).map((suggestion: {
      mapbox_id: string;
      name: string;
      full_address?: string;
      address?: string;
      place_formatted?: string;
      feature_type: string;
    }) => ({
      id: suggestion.mapbox_id,
      place_name: suggestion.full_address || suggestion.place_formatted || suggestion.name,
      text: suggestion.name,
      address: suggestion.address,
      // No center/coordinates - fetched on selection
    }));

    return NextResponse.json({ features, sessionToken });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/geocode
 * Retrieves coordinates for a selected suggestion (1 API call on selection only)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mapbox_id, session_token } = body;

    if (!mapbox_id) {
      return NextResponse.json(
        { error: "Missing mapbox_id" },
        { status: 400 }
      );
    }

    if (!MAPBOX_TOKEN) {
      return NextResponse.json(
        { error: "Mapbox token not configured" },
        { status: 500 }
      );
    }

    // Use the session token from the suggest call for billing efficiency
    const retrieveUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapbox_id}`;
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      session_token: session_token || sessionToken,
    });

    const response = await fetch(`${retrieveUrl}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();
    const feature = data.features?.[0];

    if (!feature?.geometry?.coordinates) {
      return NextResponse.json(
        { error: "Could not retrieve coordinates" },
        { status: 404 }
      );
    }

    const [lng, lat] = feature.geometry.coordinates as [number, number];

    // Reset session token after completing a search flow
    sessionToken = crypto.randomUUID();

    return NextResponse.json({
      center: [lng, lat],
      place_name: feature.properties?.full_address || feature.properties?.name,
    });
  } catch (error) {
    console.error("Retrieve error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve coordinates" },
      { status: 500 }
    );
  }
}

