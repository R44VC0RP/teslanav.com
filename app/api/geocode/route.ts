import { NextRequest, NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

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
    // Build Mapbox Geocoding API URL
    const baseUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`;
    
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      limit: "5",
      types: "address,poi,place,locality,neighborhood",
      language: "en",
    });

    // Add proximity bias if provided (prioritize results near user)
    if (proximity) {
      params.set("proximity", proximity);
    }

    const response = await fetch(`${baseUrl}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform response to simpler format
    const features = data.features.map((feature: {
      id: string;
      place_name: string;
      center: [number, number];
      text: string;
      address?: string;
    }) => ({
      id: feature.id,
      place_name: feature.place_name,
      center: feature.center,
      text: feature.text,
      address: feature.address,
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

