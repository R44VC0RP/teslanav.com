import { NextRequest, NextResponse } from "next/server";
import { deleteRecording, getRecording } from "@/lib/db";

/**
 * GET /api/recording/[id] - Download a GPX recording from SQLite
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recording = getRecording(id);

    if (!recording) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 }
      );
    }

    return new NextResponse(recording.gpx, {
      headers: {
        "Content-Type": "application/gpx+xml",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Recording fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recording" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/recording/[id] - Delete a recording from SQLite
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = deleteRecording(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedId: id,
    });
  } catch (error) {
    console.error("Recording delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete recording" },
      { status: 500 }
    );
  }
}
