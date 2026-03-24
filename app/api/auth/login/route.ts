import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmail,
  getPasswordHash,
  verifyPassword,
  generateToken,
  createSession,
} from "@/lib/auth";
import { LoginRequest, AuthResponse } from "@/types/auth";

export async function POST(request: NextRequest): Promise<NextResponse<AuthResponse>> {
  try {
    const body: LoginRequest = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    // Get user
    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Verify password
    const passwordHash = await getPasswordHash(user.id);
    if (!passwordHash || !verifyPassword(password, passwordHash)) {
      return NextResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 }
      );
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
      maxAge: 86400 * 30, // 30 days
      path: "/",
    });

    return httpResponse;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
