import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/current-user";
import { database } from "@/lib/database";

interface CarSessionRow {
  id: string;
  selected_vin: string;
  created_at: string;
  expires_at: string;
}

export async function GET(): Promise<NextResponse> {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const rows = database
    .prepare(
      `SELECT id, selected_vin, created_at, expires_at
       FROM car_session WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC`
    )
    .all(session.user.id, new Date().toISOString()) as CarSessionRow[];
  return NextResponse.json({
    sessions: rows.map((row) => ({
      id: row.id,
      vinEnding: row.selected_vin.slice(-6),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
}

export async function DELETE(): Promise<NextResponse> {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const result = database
    .prepare("DELETE FROM car_session WHERE user_id = ?")
    .run(session.user.id);
  return NextResponse.json({ revoked: result.changes });
}
