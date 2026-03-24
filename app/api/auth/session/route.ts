import { NextRequest, NextResponse } from "next/server";
import { getTokenFromHeader, getUserFromToken } from "@/lib/auth";
import { AuthResponse } from "@/types/auth";

export async function GET(request: NextRequest): Promise<NextResponse<AuthResponse>> {
  try {
    const token =
      getTokenFromHeader(request.headers.get("authorization")) ||
      request.cookies.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "No token provided" },
        { status: 401 }
      );
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const response: AuthResponse = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      token,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
