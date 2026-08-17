import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  exchangeTeslaCode,
  fetchTeslaProfile,
} from "@/lib/tesla-api";
import {
  createPhoneSession,
  encryptSecret,
  hashToken,
} from "@/lib/tesla-auth";
import {
  findAccountByTeslaUser,
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";
import type { TeslaAccount } from "@/types/tesla";

interface OAuthState {
  linkId: string;
  nonce: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.teslanav.com";
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL(`/connect?error=${encodeURIComponent(error ?? "oauth_failed")}`, appUrl)
    );
  }

  try {
    const stateKey = `tesla:oauth-state:${hashToken(state)}`;
    const oauthState = await redis.get<OAuthState>(stateKey);
    await redis.del(stateKey);
    if (!oauthState) throw new Error("OAuth state expired");

    const link = await getLinkSession(oauthState.linkId);
    if (!link) throw new Error("Device link expired");

    const tokens = await exchangeTeslaCode(code);
    const profile = await fetchTeslaProfile(tokens.accessToken);
    const existing = await findAccountByTeslaUser(tokens.subject);
    const now = new Date().toISOString();
    const accountId =
      existing?.id ??
      createHash("sha256").update(tokens.subject).digest("hex").slice(0, 32);
    const account: TeslaAccount = {
      id: accountId,
      teslaUserId: tokens.subject,
      email: profile.email,
      region: process.env.TESLA_FLEET_REGION ?? "na",
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: encryptSecret(tokens.refreshToken),
      accessTokenExpiresAt: tokens.expiresAt,
      vehicles: profile.vehicles,
      selectedVin:
        existing?.selectedVin ??
        (profile.vehicles.length === 1 ? profile.vehicles[0].vin : null),
      subscriptionStatus: existing?.subscriptionStatus ?? "inactive",
      stripeCustomerId: existing?.stripeCustomerId ?? null,
      stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
      telemetryConfiguredAt: existing?.telemetryConfiguredAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveAccount(account);
    await createPhoneSession(account.id);
    link.accountId = account.id;
    link.selectedVin = account.selectedVin;
    link.status = "authorized";
    await saveLinkSession(link);

    return NextResponse.redirect(
      new URL(`/connect?link=${encodeURIComponent(link.id)}`, appUrl)
    );
  } catch (callbackError) {
    console.error("[TeslaOAuth] callback failed:", callbackError);
    return NextResponse.redirect(new URL("/connect?error=oauth_failed", appUrl));
  }
}
