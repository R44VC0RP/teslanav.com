import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSuggestion,
  insertSuggestion,
  logAppEvent,
  markSuggestionEmailed,
  markSuggestionEmailFailed,
} from "@/lib/db";
import { getRedisClient } from "@/lib/redis";

const suggestionSchema = z.object({
  submissionId: z.string().uuid(),
  message: z.string().trim().min(10).max(2000),
  honeypot: z.string().max(200).optional().default(""),
  startedAt: z.number().int().positive(),
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

function requestFingerprint(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHmac(
    "sha256",
    process.env.ANALYTICS_HASH_SECRET || "teslanav-suggestion-rate-limit-v1"
  )
    .update(address)
    .digest("hex")
    .slice(0, 24);
}

async function checkRateLimit(request: NextRequest): Promise<boolean> {
  const now = Date.now();
  const fingerprint = requestFingerprint(request);
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
    `suggestions:ip:${fingerprint}:hour:${hour}`,
    `suggestions:ip:${fingerprint}:day:${day}`,
    `suggestions:global:hour:${hour}`
  )) as [number, number, number];
  return result[0] <= 3 && result[1] <= 8 && result[2] <= 100;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

async function sendSuggestionEmail(id: number, submissionId: string, message: string) {
  const apiKey = process.env.INBOUND_API_KEY;
  if (!apiKey) throw new Error("Inbound email is not configured");

  const timestamp = new Date().toISOString();
  const response = await fetch("https://inbound.new/api/v2/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `teslanav-suggestion-${submissionId}`,
    },
    body: JSON.stringify({
      from: "TeslaNav Suggestions <suggestions@teslanav.com>",
      to: [process.env.SUGGESTION_TO_EMAIL || "me@teslanav.com"],
      subject: `New TeslaNav suggestion #${id}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#171717">
          <h2 style="border-bottom:2px solid #3b82f6;padding-bottom:12px">New TeslaNav Suggestion</h2>
          <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;white-space:pre-wrap">${escapeHtml(message)}</div>
          <p style="color:#64748b;font-size:12px">Suggestion #${id}<br>Submitted ${timestamp}</p>
        </div>
      `,
      text: `New TeslaNav Suggestion #${id}\n\n${message}\n\nSubmitted ${timestamp}`,
      tags: [{ name: "type", value: "suggestion" }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Inbound returned ${response.status}: ${detail}`);
  }
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const parsed = suggestionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a suggestion between 10 and 2,000 characters." }, { status: 400 });
    }
    const { submissionId, message, honeypot, startedAt } = parsed.data;

    // Quietly absorb obvious form bots instead of teaching them how to adapt.
    if (honeypot || Date.now() - startedAt < 1500) {
      return NextResponse.json({ success: true });
    }

    const existing = getSuggestion(submissionId);
    if (existing?.emailedAt) {
      return NextResponse.json({ success: true, id: existing.id });
    }

    if (!(await checkRateLimit(request))) {
      return NextResponse.json(
        { error: "Suggestion limit reached. Please try again later." },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    const suggestion = existing ?? insertSuggestion(submissionId, message);
    try {
      await sendSuggestionEmail(suggestion.id, submissionId, suggestion.message);
      markSuggestionEmailed(suggestion.id);
      logAppEvent("info", "suggestions", "Suggestion emailed", {
        suggestionId: suggestion.id,
      });
      return NextResponse.json({ success: true, id: suggestion.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      markSuggestionEmailFailed(suggestion.id, detail);
      logAppEvent("error", "suggestions", "Suggestion email failed", {
        suggestionId: suggestion.id,
        error: detail,
      });
      return NextResponse.json(
        { error: "Suggestion was saved, but email delivery failed. Please try again later." },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("[Suggestions] submission failed:", error);
    return NextResponse.json(
      { error: "Unable to submit suggestion" },
      { status: 500 }
    );
  }
}
