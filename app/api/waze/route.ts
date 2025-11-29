import { NextRequest, NextResponse } from "next/server";

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

  try {
    const wazeUrl = new URL("https://www.waze.com/live-map/api/georss");
    wazeUrl.searchParams.set("left", left);
    wazeUrl.searchParams.set("right", right);
    wazeUrl.searchParams.set("bottom", bottom);
    wazeUrl.searchParams.set("top", top);
    wazeUrl.searchParams.set("env", "na"); // North America
    wazeUrl.searchParams.set("types", "alerts");

    const response = await fetch(wazeUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TeslaNav/1.0)",
        "Accept": "application/json",
      },
      next: { revalidate: 30 }, // Cache for 30 seconds
    });

    if (!response.ok) {
      throw new Error(`Waze API returned ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("Waze API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Waze data", alerts: [] },
      { status: 500 }
    );
  }
}

