import { NextResponse } from "next/server";
import {
  getCarSession,
  hasPaidAccess,
} from "@/lib/tesla-auth";
import { getAccount, getTeslaRoute } from "@/lib/tesla-store";

export async function GET(): Promise<NextResponse> {
  const session = await getCarSession();
  if (!session) {
    return NextResponse.json({ linked: false }, { status: 401 });
  }
  const account = await getAccount(session.accountId);
  if (!account || !hasPaidAccess(account)) {
    return NextResponse.json(
      { linked: true, subscribed: false },
      { status: 402 }
    );
  }
  const route = await getTeslaRoute(session.selectedVin);
  return NextResponse.json(
    {
      linked: true,
      subscribed: true,
      route,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
