import { NextRequest, NextResponse } from "next/server";
import type { SpeedCameraResponse } from "@/types/speedcamera";

/**
 * GET /api/speedcameras
 *
 * STUB: speed camera data previously came from the OSM Overpass API, which
 * was removed to make this app fully self-contained. Returns an empty set.
 */
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

  const response: SpeedCameraResponse = {
    cameras: [],
    timestamp: Date.now(),
    source: "osm",
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
