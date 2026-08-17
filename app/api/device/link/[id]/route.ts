import { NextRequest, NextResponse } from "next/server";
import {
  createCarSession,
  hashToken,
  hasPaidAccess,
} from "@/lib/tesla-auth";
import { getAccount, getLinkSession } from "@/lib/tesla-store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;
  const carToken = request.nextUrl.searchParams.get("token");
  const link = await getLinkSession(id);
  if (!link || !carToken || hashToken(carToken) !== link.carTokenHash) {
    return NextResponse.json({ error: "Link session expired" }, { status: 404 });
  }

  if (new Date(link.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ status: "expired" });
  }

  if (link.status === "complete" && link.accountId && link.selectedVin) {
    const account = await getAccount(link.accountId);
    if (!account || !hasPaidAccess(account)) {
      return NextResponse.json({ status: "subscribed" });
    }
    await createCarSession(account.id, link.selectedVin);
    return NextResponse.json({
      status: "complete",
      selectedVin: link.selectedVin,
    });
  }

  return NextResponse.json({
    status: link.status,
    confirmationCode: link.confirmationCode,
  });
}
