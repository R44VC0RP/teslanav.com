import { NextRequest, NextResponse } from "next/server";
import { getTokenFromHeader, getUserFromToken } from "@/lib/auth";
import { getUserStats, getUserVIPLocations } from "@/lib/checkin";

export async function GET(request: NextRequest) {
  try {
    const token =
      getTokenFromHeader(request.headers.get("authorization")) ||
      request.cookies.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      );
    }

    const stats = await getUserStats(user.id);

    if (!stats) {
      // Return default stats if user hasn't checked in yet
      return NextResponse.json({
        user,
        stats: {
          userId: user.id,
          email: user.email,
          totalCheckIns: 0,
          vipLocations: [],
          vipCount: 0,
        },
      });
    }

    return NextResponse.json({
      user,
      stats: {
        ...stats,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("User stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch user stats" },
      { status: 500 }
    );
  }
}
