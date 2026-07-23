import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/directions
 *
 * STUB: routing previously relied on the Mapbox Directions API, which was
 * removed to make this app fully self-contained. Returns an empty route set
 * so any remaining client code degrades gracefully.
 */
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

  return NextResponse.json(
    { routes: [], selectedIndex: 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
