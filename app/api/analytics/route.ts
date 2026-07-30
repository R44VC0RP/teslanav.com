import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logAppEvent, recordAnalytics } from "@/lib/db";

const eventNames = [
  "camera_alert_triggered",
  "map_mode_changed",
  "map_style_changed",
  "settings_opened",
  "feedback_opened",
  "police_alert_triggered",
  "report_opened",
  "report_submitted",
  "report_voted",
  "speed_cameras_toggled",
  "sponsor_clicked",
  "suggestion_sent",
  "theme_mode_changed",
  "ad_impression",
  "ad_click",
] as const;

const contextSchema = z.object({
  language: z.string().max(32).optional(),
  timezone: z.string().max(64).optional(),
  deviceType: z.enum(["tesla", "desktop", "mobile", "tablet", "unknown"]),
  isTesla: z.boolean(),
  screenBucket: z.string().max(32).optional(),
  referrerHost: z.string().max(255).optional(),
  mapMode: z.enum(["standard", "satellite"]),
});

const payloadSchema = z.object({
  visitorId: z.string().min(16).max(64).regex(/^[a-zA-Z0-9-]+$/),
  sessionId: z.string().min(16).max(64).regex(/^[a-zA-Z0-9-]+$/),
  type: z.enum(["session", "pageview", "heartbeat", "event"]),
  path: z.string().min(1).max(160).regex(/^\/[a-zA-Z0-9/_-]*$/),
  activeSeconds: z.number().int().min(0).max(60).optional(),
  eventName: z.enum(eventNames).optional(),
  eventValue: z.string().max(64).regex(/^[a-zA-Z0-9:_-]*$/).optional(),
  context: contextSchema,
}).superRefine((value, ctx) => {
  if (value.type === "event" && !value.eventName) {
    ctx.addIssue({ code: "custom", message: "eventName is required for events" });
  }
});

function hashIdentifier(value: string): string {
  return createHmac(
    "sha256",
    process.env.ANALYTICS_HASH_SECRET || "teslanav-anonymous-analytics-v1"
  )
    .update(value)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  if (/bot|crawler|spider|slurp|facebookexternalhit|bingpreview/i.test(
    request.headers.get("user-agent") ?? ""
  )) {
    return new NextResponse(null, { status: 204 });
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ error: "Missing origin" }, { status: 403 });
  }
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const publicHost =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      const publicProtocol = request.headers.get("x-forwarded-proto");
      const hostMatches = publicHost !== null && originUrl.host === publicHost;
      const protocolMatches =
        publicProtocol === null || originUrl.protocol === `${publicProtocol}:`;
      if (!hostMatches || !protocolMatches) {
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid analytics payload" }, { status: 400 });
    }

    const payload = parsed.data;
    recordAnalytics({
      visitorHash: hashIdentifier(payload.visitorId),
      sessionHash: hashIdentifier(payload.sessionId),
      type: payload.type,
      path: payload.path,
      activeSeconds: payload.activeSeconds,
      eventName: payload.eventName,
      eventValue: payload.eventValue,
      context: payload.context,
    });

    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Analytics] ingest failed:", error);
    logAppEvent("error", "analytics", "Analytics ingest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Analytics ingest failed" }, { status: 500 });
  }
}
