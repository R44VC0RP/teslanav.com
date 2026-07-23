import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/geocode?q=query
 *
 * STUB: geocoding previously relied on LocationIQ, which was removed to make
 * this app fully self-contained. Returns an empty result set.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");

  if (!query) {
    return NextResponse.json(
      { error: "Missing search query" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { results: [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
