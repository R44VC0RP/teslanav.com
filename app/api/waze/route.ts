import { NextRequest, NextResponse } from "next/server";
import {
  getAlertsCacheKey,
  getCachedAlerts,
  setPendingBounds,
} from "@/lib/waze-relay";
import { getWazeRtAlerts } from "@/lib/waze-rt";
import { listActiveUserReports } from "@/lib/db";
import {
  userReportToWazeAlert,
  type UserReport,
} from "@/lib/user-reports";
import type { WazeAlert } from "@/types/waze";

/**
 * GET /api/waze?left=&right=&bottom=&top=
 *
 * Serves the read-only Waze mobile RT protocol as the always-on baseline.
 * The optional userscript relay enriches it with the higher-fidelity GeoRSS
 * feed when WAZE_RELAY_SECRET is configured.
 *
 * On a cache miss we record the requested bounds (the userscript polls for
 * them) and return 202 so the client keeps its previous alerts and retries.
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
    east - west > 2 || north - south > 2
  ) {
    return NextResponse.json({ error: "Invalid bounds" }, { status: 400 });
  }

  const cacheKey = getAlertsCacheKey(left, right, bottom, top);

  const bounds = { west, east, south, north };
  let sources;
  try {
    sources = await Promise.all([
      getWazeRtAlerts(bounds),
      getCachedAlerts<{ alerts?: WazeAlert[] }>(cacheKey),
    ]);
  } catch (error) {
    console.error("[Waze] Cache read failed:", error);
    return NextResponse.json(
      { error: "Alerts are temporarily unavailable", alerts: [] },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "2",
          "X-Cache": "ERROR",
        },
      }
    );
  }
  const [rt, relayed] = sources;

  // Keep relay demand alive on every active client request, not only misses.
  // This prevents the optional GeoRSS enrichment from expiring while RT data
  // is still being served successfully.
  if (process.env.WAZE_RELAY_SECRET) {
    setPendingBounds({ left, right, bottom, top }).catch((error) =>
      console.error("[Waze] Failed to record relay bounds:", error)
    );
  }

  const merged = new Map<string, WazeAlert>();
  for (const alert of rt.alerts) merged.set(alert.id, alert);
  // GeoRSS is richer; prefer it when both sources describe the same alert.
  for (const alert of relayed?.alerts ?? []) merged.set(alert.id, alert);
  // First-party user reports ride along with Waze data. SQLite is local and
  // synchronous; a failure must never take down the alerts feed.
  try {
    for (const report of listActiveUserReports(bounds)) {
      const alert = userReportToWazeAlert(report as UserReport);
      merged.set(alert.id, alert);
    }
  } catch (error) {
    console.error("[Waze] User report read failed:", error);
  }

  if (rt.cache !== "MISS" || relayed) {
    const alerts = [...merged.values()];
    const cache = relayed || rt.cache === "HIT" ? "HIT" : "STALE";
    console.log(`[Waze] ${cache} - ${alerts.length} alerts (RT + optional GeoRSS)`);
    return NextResponse.json(
      { alerts },
      {
        headers: {
          "Cache-Control": cache === "HIT" ? "public, max-age=10" : "no-store",
          "X-Cache": cache,
          ...(rt.ageMs !== null
            ? { "X-Data-Age": String(Math.floor(rt.ageMs / 1000)) }
            : {}),
        },
      }
    );
  }

  console.log("[Waze] Cache MISS - RT refresh started");
  return NextResponse.json(
    { error: "Alerts are warming up", alerts: [] },
    {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "2",
        "X-Cache": "MISS",
      },
    }
  );
}
