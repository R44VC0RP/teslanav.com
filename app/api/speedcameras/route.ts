import { NextRequest, NextResponse } from "next/server";
import { listSpeedCamerasInBounds } from "@/lib/db";
import type {
  SpeedCamera,
  SpeedCameraResponse,
  SpeedCameraSource,
  SpeedCameraType,
} from "@/types/speedcamera";

/**
 * GET /api/speedcameras?left=&right=&bottom=&top=
 *
 * Serves fixed speed / red-light camera locations from the local SQLite
 * table populated by the admin-triggered importer (lib/speed-cameras.ts).
 * No runtime calls leave the box; OSM rows carry ODbL attribution in the UI.
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

  const west = Number(left);
  const east = Number(right);
  const south = Number(bottom);
  const north = Number(top);
  if (
    ![west, east, south, north].every(Number.isFinite) ||
    west >= east || south >= north ||
    west < -180 || east > 180 || south < -90 || north > 90 ||
    east - west > 4 || north - south > 4
  ) {
    return NextResponse.json({ error: "Invalid bounds" }, { status: 400 });
  }

  try {
    const cameras: SpeedCamera[] = listSpeedCamerasInBounds({
      west,
      east,
      south,
      north,
    }).map((row) => ({
      id: row.id,
      type: row.type as SpeedCameraType,
      location: { lat: row.lat, lon: row.lon },
      ...(row.maxspeed ? { maxspeed: row.maxspeed } : {}),
      ...(row.direction ? { direction: row.direction } : {}),
      ...(row.name ? { name: row.name } : {}),
      source: row.source as SpeedCameraSource,
    }));

    const response: SpeedCameraResponse = {
      cameras,
      timestamp: Date.now(),
      source: "teslanav-db",
    };
    return NextResponse.json(response, {
      // Static infrastructure data; let browsers cache for 5 minutes.
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("[SpeedCameras] query failed:", error);
    return NextResponse.json(
      { error: "Speed cameras are temporarily unavailable", cameras: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
