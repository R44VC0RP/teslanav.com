import { NextRequest, NextResponse } from "next/server";
import { createCheckIn } from "@/lib/checkin";
import { getTokenFromHeader, getUserFromToken } from "@/lib/auth";
import { CheckInResponse } from "@/types/checkin";

export async function POST(request: NextRequest): Promise<NextResponse<CheckInResponse>> {
  try {
    const token =
      getTokenFromHeader(request.headers.get("authorization")) ||
      request.cookies.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { superchargerId } = body;

    if (!superchargerId) {
      return NextResponse.json(
        { success: false, message: "Supercharger ID required" },
        { status: 400 }
      );
    }

    // Create check-in
    const checkIn = await createCheckIn(user.id, superchargerId);

    // Check if user is now VIP
    // This will be determined by leaderboard logic
    const response: CheckInResponse = {
      success: true,
      checkIn,
      isVIP: false, // Would check leaderboard position
      message: `Checked in successfully! You have ${checkIn.count} check-ins here.`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Check-in error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create check-in" },
      { status: 500 }
    );
  }
}
