import { NextRequest, NextResponse } from "next/server";

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
  geometry: {
    coordinates: [number, number][];
    type: string;
  };
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
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
      alternatives: "false",
    });

    const response = await fetch(
      `https://api.mapbox.com/directions/v5/${profile}/${coordinates}?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return NextResponse.json(
        { error: "No route found" },
        { status: 404 }
      );
    }

    const route = data.routes[0];

    // Extract route data
    const routeData: RouteData = {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      steps: route.legs[0].steps.map((step: {
        maneuver: {
          instruction: string;
          type: string;
          modifier?: string;
          bearing_after?: number;
        };
        distance: number;
        duration: number;
        name: string;
      }) => ({
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

    return NextResponse.json(routeData);
  } catch (error) {
    console.error("Directions error:", error);
    return NextResponse.json(
      { error: "Directions request failed" },
      { status: 500 }
    );
  }
}

