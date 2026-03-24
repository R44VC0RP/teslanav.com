import { NextRequest, NextResponse } from "next/server";
import { getSuperchargersByBounds } from "@/lib/tesla-fleet-api";
import {
  getSuperchargersByBoundsFromCache,
  cacheSuperchargersByBounds,
  cacheSupercharger,
} from "@/lib/supercharger-cache";

interface BoundsQuery {
  minLat?: string;
  minLng?: string;
  maxLat?: string;
  maxLng?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { minLat, minLng, maxLat, maxLng } = Object.fromEntries(
      searchParams.entries()
    ) as BoundsQuery;

    // Validate bounds
    if (!minLat || !minLng || !maxLat || !maxLng) {
      return NextResponse.json(
        { error: "Missing bounds parameters: minLat, minLng, maxLat, maxLng" },
        { status: 400 }
      );
    }

    const bounds = {
      minLat: parseFloat(minLat),
      minLng: parseFloat(minLng),
      maxLat: parseFloat(maxLat),
      maxLng: parseFloat(maxLng),
    };

    // Validate bounds values
    if (
      isNaN(bounds.minLat) ||
      isNaN(bounds.minLng) ||
      isNaN(bounds.maxLat) ||
      isNaN(bounds.maxLng)
    ) {
      return NextResponse.json(
        { error: "Invalid bounds values" },
        { status: 400 }
      );
    }

    // Try to get from cache first
    const cached = await getSuperchargersByBoundsFromCache(bounds);
    if (cached) {
      return NextResponse.json({ superchargers: cached });
    }

    // Fetch from Tesla API
    const data = await getSuperchargersByBounds(
      bounds.minLat,
      bounds.minLng,
      bounds.maxLat,
      bounds.maxLng
    );

    // Cache results
    if (data && data.superchargers && Array.isArray(data.superchargers)) {
      for (const supercharger of data.superchargers) {
        await cacheSupercharger(supercharger);
      }
      await cacheSuperchargersByBounds(data.superchargers, bounds);
    }

    return NextResponse.json({ superchargers: data.superchargers || [] });
  } catch (error) {
    console.error("Superchargers API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch superchargers" },
      { status: 500 }
    );
  }
}
