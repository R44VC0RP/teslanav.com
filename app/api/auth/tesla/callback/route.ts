import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/database";
import {
  exchangeTeslaCode,
  fetchTeslaProfile,
} from "@/lib/tesla-api";
import {
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
  userId: string;
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
    const stateHash = hashToken(state);
    const stateRow = database
      .prepare(
        `SELECT user_id, link_id, nonce FROM tesla_oauth_state
         WHERE state_hash = ? AND expires_at > ?`
      )
      .get(stateHash, new Date().toISOString()) as
      | { user_id: string; link_id: string; nonce: string }
      | undefined;
    database
      .prepare("DELETE FROM tesla_oauth_state WHERE state_hash = ?")
      .run(stateHash);
    const oauthState: OAuthState | null = stateRow
      ? {
          userId: stateRow.user_id,
          linkId: stateRow.link_id,
          nonce: stateRow.nonce,
        }
      : null;
    if (!oauthState) throw new Error("OAuth state expired");

    const link = await getLinkSession(oauthState.linkId);
    if (!link) throw new Error("Device link expired");

    const tokens = await exchangeTeslaCode(code);
    const profile = await fetchTeslaProfile(tokens.accessToken);
    const existing = await findAccountByTeslaUser(tokens.subject);
    if (existing && existing.id !== oauthState.userId) {
      throw new Error("This Tesla account is linked to another TeslaNav user");
    }
    const now = new Date().toISOString();
    const account: TeslaAccount = {
      id: oauthState.userId,
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
      telemetryConfiguredAt: existing?.telemetryConfiguredAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveAccount(account);
    link.accountId = account.id;
    link.selectedVin = account.selectedVin;
    link.status = "authorized";
    link.expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await saveLinkSession(link);

    return NextResponse.redirect(
      new URL(`/connect?link=${encodeURIComponent(link.id)}`, appUrl)
    );
  } catch (callbackError) {
    console.error("[TeslaOAuth] callback failed:", callbackError);
    return NextResponse.redirect(new URL("/connect?error=oauth_failed", appUrl));
  }
}
