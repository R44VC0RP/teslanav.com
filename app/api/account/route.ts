import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPhoneAccount, hasPaidAccess } from "@/lib/tesla-auth";
import {
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";

const updateSchema = z.object({
  selectedVin: z.string().min(5).max(32),
  linkId: z.string().optional(),
});

function publicAccount(account: NonNullable<Awaited<ReturnType<typeof getPhoneAccount>>>) {
  return {
    id: account.id,
    email: account.email,
    vehicles: account.vehicles,
    selectedVin: account.selectedVin,
    subscriptionStatus: account.subscriptionStatus,
    hasPaidAccess: hasPaidAccess(account),
    telemetryConfiguredAt: account.telemetryConfiguredAt,
  };
}

export async function GET(): Promise<NextResponse> {
  const account = await getPhoneAccount();
  if (!account) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, account: publicAccount(account) });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const account = await getPhoneAccount();
  if (!account) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
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
  return NextResponse.json({ account: publicAccount(account) });
}
