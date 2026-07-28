import { createHmac, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  confirmUserReport,
  countActiveUserReportsByReporter,
  findNearbyActiveUserReport,
  insertUserReport,
  logAppEvent,
} from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import {
  USER_REPORT_MAX_LIFETIME_MULTIPLIER,
  USER_REPORT_MERGE_RADIUS_DEG,
  USER_REPORT_TTL_MS,
  USER_REPORT_TYPES,
  userReportToWazeAlert,
  type UserReport,
} from "@/lib/user-reports";

/**
 * POST /api/reports
 *
 * First-party map reports (police, accident, hazard, closure, traffic).
 * Stored in SQLite only and merged into /api/waze responses; never sent
 * upstream to Waze. A same-type report within ~250m of an active one counts
 * as a confirmation instead of a duplicate marker.
 */

const MAX_ACTIVE_REPORTS_PER_REPORTER = 8;

const reportSchema = z.object({
  type: z.enum(USER_REPORT_TYPES),
  lat: z.number().min(-85).max(85),
  lon: z.number().min(-180).max(180),
});

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const publicHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const publicProtocol = request.headers.get("x-forwarded-proto");
    return (
      publicHost !== null &&
      originUrl.host === publicHost &&
      (publicProtocol === null || originUrl.protocol === `${publicProtocol}:`)
    );
  } catch {
    return false;
  }
}

/**
 * Day-scoped HMAC of the caller's IP: stable enough for rate limits and the
 * active-report cap, but never a long-lived identifier in the database.
 */
function reporterFingerprint(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const day = Math.floor(Date.now() / 86_400_000);
  return createHmac(
    "sha256",
    process.env.ANALYTICS_HASH_SECRET || "teslanav-user-report-v1"
  )
    .update(`${day}:${address}`)
    .digest("hex")
    .slice(0, 24);
}

async function checkRateLimit(
  request: NextRequest,
  fingerprint: string
): Promise<boolean> {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const result = (await getRedisClient().eval(
    `
      local hourly = redis.call('INCR', KEYS[1])
      if hourly == 1 then redis.call('EXPIRE', KEYS[1], 3700) end
      local daily = redis.call('INCR', KEYS[2])
      if daily == 1 then redis.call('EXPIRE', KEYS[2], 90000) end
      local global = redis.call('INCR', KEYS[3])
      if global == 1 then redis.call('EXPIRE', KEYS[3], 3700) end
      return { hourly, daily, global }
    `,
    3,
    `reports:ip:${fingerprint}:hour:${hour}`,
    `reports:ip:${fingerprint}:day:${day}`,
    `reports:global:hour:${hour}`
  )) as [number, number, number];
  return result[0] <= 6 && result[1] <= 24 && result[2] <= 300;
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const parsed = reportSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
    const { type, lat, lon } = parsed.data;
    const fingerprint = reporterFingerprint(request);

    if (!(await checkRateLimit(request, fingerprint))) {
      return NextResponse.json(
        { error: "Report limit reached. Please try again later." },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    const ttlMs = USER_REPORT_TTL_MS[type];

    // A nearby active report of the same type becomes a confirmation.
    const nearby = findNearbyActiveUserReport(
      type,
      lat,
      lon,
      USER_REPORT_MERGE_RADIUS_DEG
    );
    if (nearby) {
      const confirmed =
        confirmUserReport(
          nearby.id,
          ttlMs,
          ttlMs * USER_REPORT_MAX_LIFETIME_MULTIPLIER
        ) ?? nearby;
      return NextResponse.json({
        success: true,
        merged: true,
        alert: userReportToWazeAlert(confirmed as UserReport),
      });
    }

    if (
      countActiveUserReportsByReporter(fingerprint) >=
      MAX_ACTIVE_REPORTS_PER_REPORTER
    ) {
      return NextResponse.json(
        { error: "Too many active reports. Please try again later." },
        { status: 429, headers: { "Retry-After": "1800" } }
      );
    }

    const report = insertUserReport({
      id: randomUUID(),
      type,
      lat,
      lon,
      reporterHash: fingerprint,
      ttlMs,
    });
    // Operational log only; no coordinates (see AGENTS.md analytics privacy).
    logAppEvent("info", "user-reports", "User report created", { type });

    return NextResponse.json(
      {
        success: true,
        merged: false,
        alert: userReportToWazeAlert(report as UserReport),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Reports] submission failed:", error);
    return NextResponse.json(
      { error: "Unable to submit report" },
      { status: 500 }
    );
  }
}
