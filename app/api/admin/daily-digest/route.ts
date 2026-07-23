import { NextRequest, NextResponse } from "next/server";
import {
  buildAnalyticsDigest,
  previousDayInTimeZone,
  renderAnalyticsDigestHtml,
  sendAnalyticsDigest,
} from "@/lib/analytics-digest";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ADMIN_API_KEY;
  const providedKey = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!apiKey || providedKey !== apiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const test = request.nextUrl.searchParams.get("test") === "1";
    if (request.nextUrl.searchParams.get("preview") === "1") {
      const timeZone = process.env.ANALYTICS_DIGEST_TIMEZONE || "America/New_York";
      const reportDay = previousDayInTimeZone(timeZone);
      const digest = buildAnalyticsDigest(reportDay, timeZone);
      return new NextResponse(renderAnalyticsDigestHtml(digest, true), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    const result = await sendAnalyticsDigest(test);
    return NextResponse.json({
      sent: result.sent,
      duplicate: result.duplicate,
      reportDay: result.reportDay,
      recipient: result.recipient,
      dataSource: result.digest.dataSource,
      summary: result.digest.summary,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[AnalyticsDigest] send failed:", detail);
    return NextResponse.json(
      { error: "Daily analytics email failed", detail },
      { status: 502 }
    );
  }
}
