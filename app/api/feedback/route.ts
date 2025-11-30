import { NextRequest, NextResponse } from "next/server";

const INBOUND_API_KEY = process.env.INBOUND_API_KEY;
const INBOUND_API_URL = "https://inbound.new/api/v2/emails";

// Simple in-memory rate limiting (in production, use Redis)
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

    // Validate email if provided
    if (email && typeof email === "string" && email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: "Invalid email address" },
          { status: 400 }
        );
      }
    }

    if (!INBOUND_API_KEY) {
      console.error("INBOUND_API_KEY is not set");
      return NextResponse.json(
        { error: "Email service not configured" },
        { status: 500 }
      );
    }

    // Construct email content
    const timestamp = new Date().toISOString();
    const userEmail = email && email.trim() ? email.trim() : "Not provided";
    
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">New TeslaNav Feedback</h2>
        
        <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Feedback Message</p>
          <p style="margin: 0; color: #1a1a1a; white-space: pre-wrap;">${escapeHtml(feedback.trim())}</p>
        </div>
        
        <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; text-transform: uppercase;">Contact Email</p>
          <p style="margin: 0; color: #1a1a1a;">${escapeHtml(userEmail)}</p>
        </div>
        
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
          Submitted at: ${timestamp}<br/>
          IP: ${ip}
        </p>
      </div>
    `;

    const textContent = `
New TeslaNav Feedback
=====================

Feedback Message:
${feedback.trim()}

Contact Email: ${userEmail}

Submitted at: ${timestamp}
IP: ${ip}
    `.trim();

    // Send email via Inbound API
    const response = await fetch(INBOUND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INBOUND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TeslaNav Feedback <feedback@teslanav.com>",
        to: ["ryan@mandarin3d.com"],
        subject: `TeslaNav Feedback${email ? ` from ${email}` : ""}`,
        html: htmlContent,
        text: textContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Inbound API error:", response.status, errorData);
      return NextResponse.json(
        { error: "Failed to send feedback" },
        { status: 500 }
      );
    }

    const result = await response.json();
    console.log("Feedback email sent:", result.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Feedback submission error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper to escape HTML to prevent XSS in emails
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

