import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/lib/current-user";
import { hashToken } from "@/lib/tesla-auth";
import {
  getAccount,
  getLinkSession,
  saveLinkSession,
} from "@/lib/tesla-store";

const schema = z.object({
  linkId: z.string().min(1),
  phoneToken: z.string().min(16),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid link session" }, { status: 400 });
  }
  const link = await getLinkSession(parsed.data.linkId);
  if (
    !link ||
    hashToken(parsed.data.phoneToken) !== link.phoneTokenHash ||
    new Date(link.expiresAt).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "Link session expired" }, { status: 404 });
  }
  if (link.accountId && link.accountId !== session.user.id) {
    return NextResponse.json(
      { error: "Link session belongs to another account" },
      { status: 409 }
    );
  }

  const account = await getAccount(session.user.id);
  link.accountId = session.user.id;
  link.selectedVin = account?.selectedVin ?? null;
  if (account) link.status = "authorized";
  link.expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await saveLinkSession(link);
  return NextResponse.json({ claimed: true });
}
