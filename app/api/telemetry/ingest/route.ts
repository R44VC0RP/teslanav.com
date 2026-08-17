import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decodeTeslaRouteLine } from "@/lib/tesla-route-line";
import { getTeslaRoute, saveTeslaRoute } from "@/lib/tesla-store";
import type { TeslaRoute } from "@/types/tesla";

const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const payloadSchema = z.object({
  vin: z.string().min(5).max(32),
  fields: z.object({
    RouteLine: z.string().optional(),
    DestinationName: z.string().nullable().optional(),
    DestinationLocation: locationSchema.nullable().optional(),
    MilesToArrival: z.number().nullable().optional(),
    MinutesToArrival: z.number().nullable().optional(),
    RouteTrafficMinutesDelay: z.number().nullable().optional(),
  }),
});

function authorized(request: NextRequest): boolean {
  const expected = process.env.TESLA_TELEMETRY_INGEST_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = payloadSchema.parse(await request.json());
    const previous = await getTeslaRoute(payload.vin);
    let coordinates = previous?.coordinates ?? [];
    if (payload.fields.RouteLine) {
      coordinates = decodeTeslaRouteLine(payload.fields.RouteLine);
    }
    const route: TeslaRoute = {
      vin: payload.vin,
      coordinates,
      destinationName:
        payload.fields.DestinationName ?? previous?.destinationName ?? null,
      destination:
        payload.fields.DestinationLocation ?? previous?.destination ?? null,
      milesToArrival:
        payload.fields.MilesToArrival ?? previous?.milesToArrival ?? null,
      minutesToArrival:
        payload.fields.MinutesToArrival ?? previous?.minutesToArrival ?? null,
      trafficMinutesDelay:
        payload.fields.RouteTrafficMinutesDelay ??
        previous?.trafficMinutesDelay ??
        null,
      updatedAt: new Date().toISOString(),
    };
    await saveTeslaRoute(route);
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("[TelemetryIngest] invalid payload:", error);
    return NextResponse.json({ error: "Invalid telemetry payload" }, { status: 400 });
  }
}
