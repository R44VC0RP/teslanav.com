import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasTeslaRouteAccess } from "@/lib/autumn";
import { getAuthSession } from "@/lib/current-user";
import {
  configureFleetTelemetry,
  getFleetTelemetryConnection,
} from "@/lib/tesla-api";
import {
  getAccount,
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";
import type { LinkSession, TeslaAccount } from "@/types/tesla";

const schema = z.object({ linkId: z.string().min(1) });

async function completeReconnect(
  link: LinkSession,
  account: TeslaAccount
): Promise<NextResponse> {
  if (!account.selectedVin) {
    return NextResponse.json({ error: "Select a vehicle first" }, { status: 400 });
  }
  link.selectedVin = account.selectedVin;
  link.status = "complete";
  link.expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await Promise.all([saveLinkSession(link), saveAccount(account)]);
  return NextResponse.json({ complete: true });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link session" }, { status: 400 });
    }
    const [link, account, hasAccess] = await Promise.all([
      getLinkSession(parsed.data.linkId),
      getAccount(session.user.id),
      hasTeslaRouteAccess(session.user.id),
    ]);
    if (!link || link.accountId !== session.user.id || !account) {
      return NextResponse.json({ error: "Reconnect session not ready" }, { status: 409 });
    }
    if (!hasAccess) {
      return NextResponse.json({ error: "Active subscription required" }, { status: 402 });
    }
    if (!account.selectedVin) {
      return NextResponse.json({ error: "Select a vehicle first" }, { status: 400 });
    }

    const connection = await getFleetTelemetryConnection(account);
    await saveAccount(connection.account);
    if (
      connection.status === "connected" ||
      (connection.status === "unknown" && connection.account.telemetryConfiguredAt)
    ) {
      return completeReconnect(link, connection.account);
    }
    if (connection.status === "unknown") {
      return NextResponse.json({ complete: false, retryable: true });
    }

    try {
      await configureFleetTelemetry(connection.account);
      connection.account.telemetryConfiguredAt = new Date().toISOString();
      connection.account.updatedAt = connection.account.telemetryConfiguredAt;
      return completeReconnect(link, connection.account);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const needsPairing =
        message.includes("missing_key") || message.toLowerCase().includes("missing key");
      return NextResponse.json({
        complete: false,
        needsPairing,
        retryable: !needsPairing,
      });
    }
  } catch (error) {
    console.error("[DeviceReconnect] failed:", error);
    return NextResponse.json(
      { error: "Unable to reconnect this vehicle" },
      { status: 500 }
    );
  }
}
