import { randomInt } from "crypto";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { getCarSession, hashToken, randomToken } from "@/lib/tesla-auth";
import { LINK_TTL_SECONDS, saveLinkSession } from "@/lib/tesla-store";
import type { LinkSession } from "@/types/tesla";

export async function POST(): Promise<NextResponse> {
  try {
    const existing = await getCarSession();
    if (existing) {
      return NextResponse.json({
        linked: true,
        selectedVin: existing.selectedVin,
      });
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.teslanav.com";
    const connectUrl = new URL("/connect", appUrl);
    connectUrl.searchParams.set("link", id);
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
      id,
      carToken,
      confirmationCode: link.confirmationCode,
      expiresAt: link.expiresAt,
      qrCode,
    });
  } catch (error) {
    console.error("[DeviceLink] create failed:", error);
    return NextResponse.json(
      { error: "Unable to start device linking" },
      { status: 500 }
    );
  }
}
