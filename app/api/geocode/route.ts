import { NextRequest, NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Session token for Search Box API (improves billing - groups suggest + retrieve calls)
let sessionToken = crypto.randomUUID();

// Calculate distance between two coordinates in meters (Haversine formula)
function getDistanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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

  // Parse user location from proximity param (format: "lng,lat")
  let userLng: number | null = null;
  let userLat: number | null = null;
  if (proximity) {
    const [lng, lat] = proximity.split(",").map(Number);
    if (!isNaN(lng) && !isNaN(lat)) {
      userLng = lng;
      userLat = lat;
    }
  }

  try {
    // Use Mapbox Search Box API for better POI/business search results
    const baseUrl = "https://api.mapbox.com/search/searchbox/v1/suggest";
    
    const params = new URLSearchParams({
      q: query,
      access_token: MAPBOX_TOKEN,
      session_token: sessionToken,
      limit: "10", // Get more results so we can sort and return best ones
      language: "en",
      country: "US", // Prioritize US results
      types: "poi,address,place,street",
    });

    // Add proximity bias if provided (helps API return relevant results)
    if (proximity) {
      params.set("proximity", proximity);
    }

    const response = await fetch(`${baseUrl}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();

    // Search Box API returns suggestions - we need to retrieve full details for each
    const features = await Promise.all(
      (data.suggestions || []).map(async (suggestion: {
        mapbox_id: string;
        name: string;
        full_address?: string;
        address?: string;
        place_formatted?: string;
        feature_type: string;
        context?: {
          place?: { name: string };
          region?: { name: string };
          country?: { name: string };
        };
      }) => {
        // Build a readable place name from the suggestion
        const placeParts = [suggestion.name];
        if (suggestion.place_formatted) {
          placeParts.push(suggestion.place_formatted);
        } else if (suggestion.full_address) {
          placeParts.push(suggestion.full_address);
        } else if (suggestion.address) {
          placeParts.push(suggestion.address);
        }

        // We need to retrieve the full feature to get coordinates
        const retrieveUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}`;
        const retrieveParams = new URLSearchParams({
          access_token: MAPBOX_TOKEN,
          session_token: sessionToken,
        });

        try {
          const retrieveResponse = await fetch(`${retrieveUrl}?${retrieveParams.toString()}`);
          if (retrieveResponse.ok) {
            const retrieveData = await retrieveResponse.json();
            const feature = retrieveData.features?.[0];
            if (feature?.geometry?.coordinates) {
              const [lng, lat] = feature.geometry.coordinates as [number, number];
              
              // Calculate distance from user if we have their location
              let distance: number | null = null;
              if (userLng !== null && userLat !== null) {
                distance = getDistanceInMeters(userLat, userLng, lat, lng);
              }
              
              return {
                id: suggestion.mapbox_id,
                place_name: suggestion.full_address || placeParts.join(", "),
                center: [lng, lat] as [number, number],
                text: suggestion.name,
                address: suggestion.address,
                distance, // Include distance for sorting
              };
            }
          }
        } catch (err) {
          console.error("Failed to retrieve feature details:", err);
        }

        // Fallback if retrieve fails - skip this result
        return null;
      })
    );

    // Filter out null results
    let validFeatures = features.filter(Boolean) as Array<{
      id: string;
      place_name: string;
      center: [number, number];
      text: string;
      address?: string;
      distance: number | null;
    }>;
    
    // Sort by distance (closest first) if we have user location
    if (userLng !== null && userLat !== null) {
      validFeatures.sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }
    
    // Remove distance field from response and limit to 5 results
    const responseFeatures = validFeatures.slice(0, 5).map(({ distance, ...rest }) => rest);
    
    // Reset session token after a complete search flow
    sessionToken = crypto.randomUUID();

    return NextResponse.json({ features: responseFeatures });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 500 }
    );
  }
}

