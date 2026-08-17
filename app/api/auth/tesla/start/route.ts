import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/current-user";
import { database } from "@/lib/database";
import { buildTeslaAuthorizeUrl } from "@/lib/tesla-api";
import { hashToken, randomToken } from "@/lib/tesla-auth";
import { getLinkSession } from "@/lib/tesla-store";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
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
    database
      .prepare(
        `INSERT INTO tesla_oauth_state (
          state_hash, user_id, link_id, nonce, expires_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        hashToken(state),
        session.user.id,
        linkId,
        nonce,
        new Date(Date.now() + 10 * 60 * 1000).toISOString()
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
