import { NextResponse } from "next/server";
import { clearSessions } from "@/lib/tesla-auth";

export async function DELETE(): Promise<NextResponse> {
  await clearSessions();
  return NextResponse.json({ signedOut: true });
}
