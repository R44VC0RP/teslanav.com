import { NextRequest, NextResponse } from "next/server";
import {
  getPendingBounds,
  cacheAlerts,
  getAlertsCacheKey,
  isRelayAuthorized,
  ALERTS_CACHE_TTL_SECONDS,
} from "@/lib/waze-relay";
import { logAppEvent } from "@/lib/db";

/**
 * GET /api/waze/relay - What the userscript should fetch next.
 * Returns the bounds most recently requested by a Tesla client.
 */
export async function GET(request: NextRequest) {
  if (!isRelayAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await getPendingBounds();

  if (!pending) {
    return NextResponse.json({ bounds: null });
  }

  return NextResponse.json({
    bounds: {
      left: pending.left,
      right: pending.right,
      bottom: pending.bottom,
      top: pending.top,
    },
    requestedAt: pending.requestedAt,
  });
}

/**
 * POST /api/waze/relay - Relayed georss results from the userscript.
 * Body: { left, right, bottom, top, data }
 */
export async function POST(request: NextRequest) {
  if (!isRelayAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const body = await request.json();
    const { left, right, bottom, top, data } = body;

    if (!left || !right || !bottom || !top || !data) {
      return NextResponse.json(
        { error: "Missing bounds or data" },
        { status: 400 }
      );
    }

    const bounds = [left, right, bottom, top].map(Number);
    const [west, east, south, north] = bounds;
    if (
      !bounds.every(Number.isFinite) || west >= east || south >= north ||
      west < -180 || east > 180 || south < -90 || north > 90 ||
      east - west > 2 || north - south > 2
    ) {
      return NextResponse.json({ error: "Invalid bounds" }, { status: 400 });
    }

    if (
      typeof data !== "object" ||
      !Array.isArray((data as { alerts?: unknown }).alerts) ||
      (data as { alerts: unknown[] }).alerts.length > 1000
    ) {
      return NextResponse.json(
        { error: "Invalid georss payload" },
        { status: 400 }
      );
    }

    const cacheKey = getAlertsCacheKey(left, right, bottom, top);
    await cacheAlerts(cacheKey, data, ALERTS_CACHE_TTL_SECONDS);

    const alertCount = (data as { alerts: unknown[] }).alerts.length;
    console.log(`[WazeRelay] Cached ${alertCount} alerts for ${cacheKey}`);

    return NextResponse.json({ success: true, alerts: alertCount });
  } catch (error) {
    console.error("[WazeRelay] store failed:", error);
    logAppEvent("error", "waze-relay", "Failed to store relay data", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to store relay data" },
      { status: 500 }
    );
  }
}
