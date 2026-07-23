import { NextRequest, NextResponse } from "next/server";
import { insertRecording, listRecordings } from "@/lib/db";

/**
 * POST /api/recording - Save a GPX recording to SQLite
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, gpx, name, sessionToken } = body;

    // Validate required fields
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "Recording id is required" },
        { status: 400 }
      );
    }

    if (!gpx || typeof gpx !== "string") {
      return NextResponse.json(
        { error: "GPX data is required" },
        { status: 400 }
      );
    }

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Recording name is required" },
        { status: 400 }
      );
    }

    if (!sessionToken || typeof sessionToken !== "string") {
      return NextResponse.json(
        { error: "Session token is required" },
        { status: 400 }
      );
    }

    // Validate GPX size (max 10MB)
    if (gpx.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Recording too large (max 10MB)" },
        { status: 400 }
      );
    }

    insertRecording({ id, sessionToken, name, gpx });

    return NextResponse.json({
      success: true,
      id,
      blobUrl: `/api/recording/${id}`,
    });
  } catch (error) {
    console.error("Recording upload error:", error);
    return NextResponse.json(
      { error: "Failed to save recording" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/recording - List all recordings for a session token
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionToken = searchParams.get("sessionToken");

    if (!sessionToken) {
      return NextResponse.json(
        { error: "Session token is required" },
        { status: 400 }
      );
    }

    const recordings = listRecordings(sessionToken);

    return NextResponse.json({
      recordings: recordings.map((recording) => ({
        id: recording.id,
        name: recording.name,
        url: `/api/recording/${recording.id}`,
        size: recording.size,
        uploadedAt: recording.created_at,
      })),
    });
  } catch (error) {
    console.error("Recording list error:", error);
    return NextResponse.json(
      { error: "Failed to list recordings" },
      { status: 500 }
    );
  }
}
