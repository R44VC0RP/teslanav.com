import { NextRequest, NextResponse } from "next/server";
import { insertFeedback, logAppEvent } from "@/lib/db";

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 3; // Max 3 submissions per minute per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { feedback, email, honeypot } = body;

    // Honeypot check - if filled, it's a bot
    if (honeypot) {
      // Pretend success to confuse bots
      return NextResponse.json({ success: true });
    }

    // Validate feedback
    if (!feedback || typeof feedback !== "string" || feedback.trim().length === 0) {
      return NextResponse.json(
        { error: "Feedback message is required" },
        { status: 400 }
      );
    }

    if (feedback.length > 5000) {
      return NextResponse.json(
        { error: "Feedback message is too long" },
        { status: 400 }
      );
    }

    // Validate email format if provided
    if (email && typeof email === "string" && email.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: "Invalid email address" },
          { status: 400 }
        );
      }
    }

    const id = insertFeedback(
      feedback.trim(),
      typeof email === "string" && email.trim().length > 0 ? email.trim() : undefined
    );

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Feedback submission error:", error);
    logAppEvent("error", "feedback", "Feedback submission failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 }
    );
  }
}
