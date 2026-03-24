import { NextRequest, NextResponse } from "next/server";
import {
  getUserByOAuth,
  createUser,
  generateToken,
  createSession,
} from "@/lib/auth";
import { AuthResponse } from "@/types/auth";

export async function POST(request: NextRequest): Promise<NextResponse<AuthResponse>> {
  try {
    const body = await request.json();
    const { idToken, email, name, sub: googleId } = body;

    if (!email || !googleId) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check if user exists with this Google ID
    let user = await getUserByOAuth("google", googleId);

    // If not, check by email and link the account
    if (!user) {
      user = await getUserByOAuth("email", email);
      if (!user) {
        // Create new user
        user = await createUser(email, "", name, "google", googleId);
      }
    }

    // Generate token and session
    const token = generateToken(user.id, user.email);
    await createSession(user.id, token);

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

    const httpResponse = NextResponse.json(response, { status: 200 });
    httpResponse.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 86400 * 30,
      path: "/",
    });

    return httpResponse;
  } catch (error) {
    console.error("Google OAuth error:", error);
    return NextResponse.json(
      { success: false, message: "OAuth authentication failed" },
      { status: 500 }
    );
  }
}
