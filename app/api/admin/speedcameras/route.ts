import { NextRequest, NextResponse } from "next/server";
import { getSpeedCameraStats } from "@/lib/db";
import { importSpeedCameras } from "@/lib/speed-cameras";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

function authorized(request: NextRequest): boolean {
  if (!ADMIN_API_KEY) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader?.replace("Bearer ", "") === ADMIN_API_KEY;
}

/**
 * POST /api/admin/speedcameras — run the camera importer (OSM + Chicago + DC).
 * The only place external camera sources are contacted; run occasionally
 * (monthly is plenty — fixed cameras rarely change).
 *
 * GET /api/admin/speedcameras — current per-source row counts.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await importSpeedCameras();
    const failed = result.sources.filter((entry) => entry.error);
    return NextResponse.json(result, { status: failed.length > 0 ? 207 : 200 });
  } catch (error) {
    console.error("[AdminSpeedCameras] import failed:", error);
    return NextResponse.json(
      { error: "Speed camera import failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ stats: getSpeedCameraStats() });
  } catch (error) {
    console.error("[AdminSpeedCameras] stats failed:", error);
    return NextResponse.json(
      { error: "Failed to load camera stats" },
      { status: 500 }
    );
  }
}
