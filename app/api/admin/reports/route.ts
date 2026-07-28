import { NextRequest, NextResponse } from "next/server";
import { deleteUserReport, logAppEvent } from "@/lib/db";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * DELETE /api/admin/reports?id=<uuid>
 * Soft-deletes a user report so it disappears from /api/waze merges.
 * Clients may keep the marker for up to their 60s tile TTL.
 */
export async function DELETE(request: NextRequest) {
  if (ADMIN_API_KEY) {
    const authHeader = request.headers.get("authorization");
    const providedKey = authHeader?.replace("Bearer ", "");
    if (providedKey !== ADMIN_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Missing required id parameter" },
      { status: 400 }
    );
  }

  try {
    if (!deleteUserReport(id)) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    logAppEvent("info", "user-reports", "User report deleted by admin", { id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AdminReports] delete failed:", error);
    return NextResponse.json(
      { error: "Failed to delete report" },
      { status: 500 }
    );
  }
}
