import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  buildTeslaAuthorizeUrl,
} from "@/lib/tesla-api";
import { hashToken, randomToken } from "@/lib/tesla-auth";
import { getLinkSession } from "@/lib/tesla-store";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const linkId = request.nextUrl.searchParams.get("link");
    const phoneToken = request.nextUrl.searchParams.get("token");
    if (!linkId || !phoneToken) {
      return NextResponse.json({ error: "Missing link details" }, { status: 400 });
    }
    const link = await getLinkSession(linkId);
    if (!link || hashToken(phoneToken) !== link.phoneTokenHash) {
      return NextResponse.json({ error: "Link session expired" }, { status: 404 });
    }

    const state = randomToken();
    const nonce = randomToken();
    await redis.set(
      `tesla:oauth-state:${hashToken(state)}`,
      { linkId, nonce },
      { ex: 10 * 60 }
    );
    return NextResponse.redirect(buildTeslaAuthorizeUrl(state, nonce));
  } catch (error) {
    console.error("[TeslaOAuth] start failed:", error);
    return NextResponse.json(
      { error: "Tesla sign-in is not configured" },
      { status: 503 }
    );
  }
}
