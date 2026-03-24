import { NextRequest, NextResponse } from "next/server";
import { getLocationLeaderboard, getVIPUser } from "@/lib/checkin";
import { getSuperchargerFromCache } from "@/lib/supercharger-cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: superchargerId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "10");

    // Get supercharger details
    const supercharger = await getSuperchargerFromCache(superchargerId);

    // Get leaderboard
    const entries = await getLocationLeaderboard(superchargerId, limit);

    // Get VIP user
    const vipUserId = await getVIPUser(superchargerId);

    return NextResponse.json({
      superchargerId,
      superchargerName: supercharger?.name || "Unknown",
      entries,
      vipUserId,
    });
  } catch (error) {
    console.error("Leaderboard API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
