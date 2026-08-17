import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasTeslaRouteAccess } from "@/lib/autumn";
import { getAuthSession, getCurrentTeslaAccount } from "@/lib/current-user";
import {
  configureFleetTelemetry,
  refreshTeslaAccount,
  virtualKeyPairingUrl,
} from "@/lib/tesla-api";
import {
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";

const schema = z.object({ linkId: z.string().min(1) });

export async function GET(): Promise<NextResponse> {
  const account = await getCurrentTeslaAccount();
  if (!account?.selectedVin) {
    return NextResponse.json({ error: "Select a vehicle first" }, { status: 400 });
  }
  return NextResponse.json({
    pairingUrl: virtualKeyPairingUrl(account.selectedVin),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getAuthSession();
    const account = await getCurrentTeslaAccount();
    if (!session || !account || !(await hasTeslaRouteAccess(session.user.id))) {
      return NextResponse.json({ error: "Active subscription required" }, { status: 402 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link session" }, { status: 400 });
    }
    const link = await getLinkSession(parsed.data.linkId);
    if (!link || link.accountId !== account.id || !account.selectedVin) {
      return NextResponse.json({ error: "Link session expired" }, { status: 404 });
    }

    const refreshed = await refreshTeslaAccount(account);
    await configureFleetTelemetry(refreshed);
    refreshed.telemetryConfiguredAt = new Date().toISOString();
    refreshed.updatedAt = refreshed.telemetryConfiguredAt;
    await saveAccount(refreshed);
    link.selectedVin = refreshed.selectedVin;
    link.status = "complete";
    await saveLinkSession(link);
    return NextResponse.json({ complete: true });
  } catch (error) {
    console.error("[TeslaPair] configuration failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pairing failed" },
      { status: 409 }
    );
  }
}
