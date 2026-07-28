import { NextRequest, NextResponse } from "next/server";
import {
  getAnalyticsStats,
  getStats,
  listAppLogs,
  listFeedback,
  listSuggestions,
  listUserReports,
  listWazeRtCredentialRegions,
} from "@/lib/db";
import { getRedisClient } from "@/lib/redis";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * GET /api/admin/usage
 * Returns stats for the self-contained instance (SQLite + in-memory Redis).
 */
export async function GET(request: NextRequest) {
  if (ADMIN_API_KEY) {
    const authHeader = request.headers.get("authorization");
    const providedKey = authHeader?.replace("Bearer ", "");

    if (providedKey !== ADMIN_API_KEY) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  try {
    const stats = getStats();

    let redisKeys = 0;
    let redisOk = false;
    let wazeRt: Array<{
      region: string;
      credentialsReady: boolean;
      snapshotAgeMs: number | null;
      alertCount: number;
    }> = [];
    try {
      const redis = getRedisClient();
      redisKeys = await redis.dbsize();
      redisOk = true;
      const credentialRegions = new Set(listWazeRtCredentialRegions());
      const regions = ["na", "il", "row"];
      const snapshots = await redis.mget(
        regions.map((region) => `waze:rt:snapshot:${region}`)
      );
      wazeRt = regions.map((region, index) => {
        const raw = snapshots[index];
        if (!raw) {
          return {
            region,
            credentialsReady: credentialRegions.has(region),
            snapshotAgeMs: null,
            alertCount: 0,
          };
        }
        try {
          const snapshot = JSON.parse(raw) as {
            fetchedAt?: number;
            alerts?: unknown[];
          };
          return {
            region,
            credentialsReady: credentialRegions.has(region),
            snapshotAgeMs: snapshot.fetchedAt
              ? Date.now() - snapshot.fetchedAt
              : null,
            alertCount: snapshot.alerts?.length ?? 0,
          };
        } catch {
          return {
            region,
            credentialsReady: credentialRegions.has(region),
            snapshotAgeMs: null,
            alertCount: 0,
          };
        }
      });
    } catch {
      // Redis unreachable - report as down
    }

    return NextResponse.json({
      sqlite: stats,
      redis: {
        ok: redisOk,
        cachedKeys: redisKeys,
      },
      wazeRt,
      analytics: getAnalyticsStats(),
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
      recentLogs: listAppLogs(60),
      recentSuggestions: listSuggestions(30),
      recentFeedback: listFeedback(20),
      recentUserReports: listUserReports(30),
    });
  } catch (error) {
    console.error("Admin usage error:", error);
    return NextResponse.json(
      { error: "Failed to load usage stats" },
      { status: 500 }
    );
  }
}
