import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/geocode/reverse?lng=&lat=
 *
 * STUB: reverse geocoding previously relied on LocationIQ, which was removed
 * to make this app fully self-contained. Returns a null place name.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lng = searchParams.get("lng");
  const lat = searchParams.get("lat");

  if (!lng || !lat) {
    return NextResponse.json(
      { error: "Missing lng/lat parameters" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { placeName: null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
