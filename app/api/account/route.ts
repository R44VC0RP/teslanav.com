import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasTeslaRouteAccess } from "@/lib/autumn";
import { getAuthSession } from "@/lib/current-user";
import {
  getAccount,
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";
import type { TeslaAccount } from "@/types/tesla";

const updateSchema = z.object({
  selectedVin: z.string().min(5).max(32),
  linkId: z.string().optional(),
});

async function publicAccount(
  user: { id: string; email: string; name: string },
  account: TeslaAccount | null,
  forceBillingRefresh: boolean = false
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    teslaConnected: account !== null,
    vehicles: account?.vehicles ?? [],
    selectedVin: account?.selectedVin ?? null,
    hasPaidAccess: await hasTeslaRouteAccess(user.id, forceBillingRefresh),
    telemetryConfiguredAt: account?.telemetryConfiguredAt ?? null,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const account = await getAccount(session.user.id);
  return NextResponse.json({
    authenticated: true,
    account: await publicAccount(
      session.user,
      account,
      request.nextUrl.searchParams.get("refreshBilling") === "true"
    ),
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const account = await getAccount(session.user.id);
  if (!account) {
    return NextResponse.json({ error: "Connect Tesla first" }, { status: 409 });
  }
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid vehicle selection" }, { status: 400 });
  }
  if (!account.vehicles.some((vehicle) => vehicle.vin === parsed.data.selectedVin)) {
    return NextResponse.json({ error: "Vehicle is not on this account" }, { status: 403 });
  }

  account.selectedVin = parsed.data.selectedVin;
  account.updatedAt = new Date().toISOString();
  await saveAccount(account);

  if (parsed.data.linkId) {
    const link = await getLinkSession(parsed.data.linkId);
    if (link?.accountId === account.id) {
      link.selectedVin = account.selectedVin;
      await saveLinkSession(link);
    }
  }
  return NextResponse.json({
    account: await publicAccount(session.user, account),
  });
}
