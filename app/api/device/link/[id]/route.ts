import { NextRequest, NextResponse } from "next/server";
import { hasTeslaRouteAccess } from "@/lib/autumn";
import { createCarSession, hashToken } from "@/lib/tesla-auth";
import { getLinkSession } from "@/lib/tesla-store";

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
    if (!(await hasTeslaRouteAccess(link.accountId))) {
      return NextResponse.json({ status: "subscribed" });
    }
    await createCarSession(link.accountId, link.selectedVin);
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
