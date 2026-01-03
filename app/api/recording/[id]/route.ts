import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";

/**
 * DELETE /api/recording/[id] - Delete a recording from Vercel Blob
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { blobUrl } = body;

    if (!blobUrl || typeof blobUrl !== "string") {
      return NextResponse.json(
        { error: "Blob URL is required" },
        { status: 400 }
      );
    }

    // Delete from Vercel Blob
    await del(blobUrl);

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
