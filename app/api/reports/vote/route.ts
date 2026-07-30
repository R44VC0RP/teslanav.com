import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  confirmUserReport,
  dismissUserReport,
  getUserReport,
  logAppEvent,
} from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import {
  USER_REPORT_MAX_LIFETIME_MULTIPLIER,
  USER_REPORT_TTL_MS,
  userReportToWazeAlert,
  type UserReport,
  type UserReportType,
} from "@/lib/user-reports";

/**
 * POST /api/reports/vote
 *
 * "Still there" / "Gone" voting on first-party reports. Confirmations renew
 * the report's window (bounded by its max lifetime); three "gone" votes
 * expire it early. One vote per report per fingerprint per six hours.
 */

const DISMISSALS_TO_EXPIRE = 3;

const voteSchema = z.object({
  reportId: z.string().uuid(),
  vote: z.enum(["confirm", "gone"]),
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

function voterFingerprint(request: NextRequest): string {
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

async function allowVote(
  fingerprint: string,
  reportId: string
): Promise<{ allowed: boolean; duplicate: boolean }> {
  const redis = getRedisClient();
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  // One vote per report per fingerprint (6h), plus hourly volume caps.
  const first = await redis.set(
    `reports:vote:${fingerprint}:${reportId}`,
    "1",
    "EX",
    21_600,
    "NX"
  );
  if (first === null) return { allowed: false, duplicate: true };
  const counts = (await redis.eval(
    `
      local hourly = redis.call('INCR', KEYS[1])
      if hourly == 1 then redis.call('EXPIRE', KEYS[1], 3700) end
      local global = redis.call('INCR', KEYS[2])
      if global == 1 then redis.call('EXPIRE', KEYS[2], 3700) end
      return { hourly, global }
    `,
    2,
    `reports:vote:ip:${fingerprint}:hour:${hour}`,
    `reports:vote:global:hour:${hour}`
  )) as [number, number];
  return { allowed: counts[0] <= 40 && counts[1] <= 1200, duplicate: false };
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const parsed = voteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid vote" }, { status: 400 });
    }
    const { reportId, vote } = parsed.data;

    const report = getUserReport(reportId);
    if (!report || report.expiresAt <= Date.now()) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { allowed, duplicate } = await allowVote(
      voterFingerprint(request),
      reportId
    );
    if (duplicate) {
      // Quietly absorb repeat votes so double taps feel successful.
      return NextResponse.json({ success: true, duplicate: true });
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Vote limit reached. Please try again later." },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    if (vote === "confirm") {
      const ttlMs = USER_REPORT_TTL_MS[report.type as UserReportType];
      const updated =
        confirmUserReport(
          reportId,
          ttlMs,
          ttlMs * USER_REPORT_MAX_LIFETIME_MULTIPLIER
        ) ?? report;
      return NextResponse.json({
        success: true,
        removed: false,
        alert: userReportToWazeAlert(updated as UserReport),
      });
    }

    const { report: dismissed, removed } = dismissUserReport(
      reportId,
      DISMISSALS_TO_EXPIRE
    );
    if (!dismissed) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (removed) {
      logAppEvent("info", "user-reports", "Report expired by votes", {
        type: dismissed.type,
      });
    }
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error("[Reports] vote failed:", error);
    return NextResponse.json(
      { error: "Unable to submit vote" },
      { status: 500 }
    );
  }
}
