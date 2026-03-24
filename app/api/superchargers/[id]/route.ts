import { NextRequest, NextResponse } from "next/server";
import { getSuperchargerById, getSuperchargerAvailability, getSuperchargerPricing } from "@/lib/tesla-fleet-api";
import {
  getSuperchargerFromCache,
  cacheSupercharger,
  getAvailabilityFromCache,
  cacheAvailability,
  getPricingFromCache,
  cachePricing,
} from "@/lib/supercharger-cache";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const searchParams = request.nextUrl.searchParams;
    const includeAvailability = searchParams.get("availability") === "true";
    const includePricing = searchParams.get("pricing") === "true";

    // Get supercharger from cache
    let supercharger = await getSuperchargerFromCache(id);

    if (!supercharger) {
      // Fetch from Tesla API
      const data = await getSuperchargerById(id);
      supercharger = data;

      // Cache it
      await cacheSupercharger(supercharger);
    }

    // Get availability if requested
    let availability = null;
    if (includeAvailability) {
      availability = await getAvailabilityFromCache(id);
      if (!availability) {
        try {
          const data = await getSuperchargerAvailability(id);
          availability = data;
          await cacheAvailability(id, data);
        } catch (error) {
          console.warn("Could not fetch availability:", error);
        }
      }
    }

    // Get pricing if requested
    let pricing = null;
    if (includePricing) {
      pricing = await getPricingFromCache(id);
      if (!pricing) {
        try {
          const data = await getSuperchargerPricing(id);
          pricing = data;
          await cachePricing(id, data);
        } catch (error) {
          console.warn("Could not fetch pricing:", error);
        }
      }
    }

    return NextResponse.json({
      supercharger,
      availability,
      pricing,
    });
  } catch (error) {
    console.error("Supercharger details API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch supercharger details" },
      { status: 500 }
    );
  }
}
