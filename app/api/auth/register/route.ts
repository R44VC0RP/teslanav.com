import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmail,
  hashPassword,
  createUser,
  generateToken,
  createSession,
} from "@/lib/auth";
import { RegisterRequest, AuthResponse } from "@/types/auth";

export async function POST(request: NextRequest): Promise<NextResponse<AuthResponse>> {
  try {
    const body: RegisterRequest = await request.json();
    const { email, password, name } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: "Email already registered" },
        { status: 409 }
      );
    }

    // Create user
    const passwordHash = hashPassword(password);
    const user = await createUser(email, passwordHash, name, "email");

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
      },
      token,
    };

    const httpResponse = NextResponse.json(response, { status: 201 });
    httpResponse.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 86400 * 30, // 30 days
      path: "/",
    });

    return httpResponse;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
