import { randomInt } from "crypto";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import {
  getCarSession,
  getPendingLinkCookie,
  hashToken,
  randomToken,
  setPendingLinkCookie,
} from "@/lib/tesla-auth";
import {
  getLinkSession,
  LINK_TTL_SECONDS,
  saveLinkSession,
} from "@/lib/tesla-store";
import type { LinkSession } from "@/types/tesla";

async function linkResponse(
  link: LinkSession,
  phoneToken: string,
  carToken: string
): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.teslanav.com";
  const connectUrl = new URL("/connect", appUrl);
  connectUrl.searchParams.set("link", link.id);
  connectUrl.searchParams.set("token", phoneToken);
  connectUrl.searchParams.set("code", link.confirmationCode);
  const qrCode = await QRCode.toDataURL(connectUrl.toString(), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
    color: { dark: "#111827", light: "#ffffff" },
  });
  return NextResponse.json({
    linked: false,
    id: link.id,
    carToken,
    confirmationCode: link.confirmationCode,
    expiresAt: link.expiresAt,
    qrCode,
  });
}

export async function POST(): Promise<NextResponse> {
  try {
    const existing = await getCarSession();
    if (existing) {
      return NextResponse.json({
        linked: true,
        selectedVin: existing.selectedVin,
      });
    }

    const pending = await getPendingLinkCookie();
    if (pending) {
      const pendingLink = await getLinkSession(pending.id);
      if (
        pendingLink &&
        new Date(pendingLink.expiresAt).getTime() > Date.now() &&
        hashToken(pending.carToken) === pendingLink.carTokenHash &&
        hashToken(pending.phoneToken) === pendingLink.phoneTokenHash
      ) {
        return linkResponse(
          pendingLink,
          pending.phoneToken,
          pending.carToken
        );
      }
    }

    const id = randomToken(18);
    const phoneToken = randomToken();
    const carToken = randomToken();
    const now = new Date();
    const link: LinkSession = {
      id,
      phoneTokenHash: hashToken(phoneToken),
      carTokenHash: hashToken(carToken),
      confirmationCode: randomInt(100000, 1000000).toString(),
      status: "pending",
      accountId: null,
      selectedVin: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + LINK_TTL_SECONDS * 1000
      ).toISOString(),
    };
    await saveLinkSession(link);
    await setPendingLinkCookie({
      id,
      phoneToken,
      carToken,
    });
    return linkResponse(link, phoneToken, carToken);
  } catch (error) {
    console.error("[DeviceLink] create failed:", error);
    return NextResponse.json(
      { error: "Unable to start device linking" },
      { status: 500 }
    );
  }
}
