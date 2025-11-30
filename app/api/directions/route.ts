import { NextRequest, NextResponse } from "next/server";
import { trackApiUsage } from "@/lib/redis";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    bearing_after?: number;
  };
}

export interface RouteData {
  id: string;
  geometry: {
    coordinates: [number, number][];
    type: string;
  };
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
  summary: string; // e.g., "via I-95 N"
}

export interface RoutesResponse {
  routes: RouteData[];
  selectedIndex: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const originLng = searchParams.get("originLng");
  const originLat = searchParams.get("originLat");
  const destLng = searchParams.get("destLng");
  const destLat = searchParams.get("destLat");

  if (!originLng || !originLat || !destLng || !destLat) {
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

  try {
    // Use driving profile for car navigation
    const profile = "mapbox/driving-traffic";
    const coordinates = `${originLng},${originLat};${destLng},${destLat}`;
    
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      geometries: "geojson",
      overview: "full",
      steps: "true",
      annotations: "congestion,duration,distance",
      alternatives: "true", // Enable alternative routes!
    });

    const response = await fetch(
      `https://api.mapbox.com/directions/v5/${profile}/${coordinates}?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    // Track API usage
    trackApiUsage("directions").catch(console.error);

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return NextResponse.json(
        { error: "No route found" },
        { status: 404 }
      );
    }

    // Extract all routes (up to 3)
    const routes: RouteData[] = data.routes.slice(0, 3).map((route: {
      geometry: { coordinates: [number, number][]; type: string };
      distance: number;
      duration: number;
      legs: Array<{
        summary: string;
        steps: Array<{
          maneuver: {
            instruction: string;
            type: string;
            modifier?: string;
            bearing_after?: number;
          };
          distance: number;
          duration: number;
          name: string;
        }>;
      }>;
    }, index: number) => {
      // Build summary from major road names in the route
      const summary = route.legs[0]?.summary || buildRouteSummary(route.legs[0]?.steps || [], index);
      
      return {
        id: `route-${index}`,
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        summary,
        steps: route.legs[0].steps.map((step) => ({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
          name: step.name,
          maneuver: {
            type: step.maneuver.type,
            modifier: step.maneuver.modifier,
            bearing_after: step.maneuver.bearing_after,
          },
        })),
      };
    });

    // First route is fastest (Mapbox returns them sorted by duration)
    const routesResponse: RoutesResponse = {
      routes,
      selectedIndex: 0,
    };

    return NextResponse.json(routesResponse);
  } catch (error) {
    console.error("Directions error:", error);
    return NextResponse.json(
      { error: "Directions request failed" },
      { status: 500 }
    );
  }
}

// Build a human-readable summary from route steps
function buildRouteSummary(steps: Array<{ name: string; distance: number }>, index: number): string {
  // Find the longest road segment (likely a highway/main road)
  const roadSegments = steps
    .filter(s => s.name && s.name.length > 0)
    .reduce((acc, step) => {
      const existing = acc.find(r => r.name === step.name);
      if (existing) {
        existing.distance += step.distance;
      } else {
        acc.push({ name: step.name, distance: step.distance });
      }
      return acc;
    }, [] as Array<{ name: string; distance: number }>)
    .sort((a, b) => b.distance - a.distance);

  if (roadSegments.length > 0) {
    // Get the longest road segment
    const mainRoad = roadSegments[0].name;
    return `via ${mainRoad}`;
  }

  // Fallback labels
  const labels = ["Fastest route", "Alternative route", "Another route"];
  return labels[index] || `Route ${index + 1}`;
}

