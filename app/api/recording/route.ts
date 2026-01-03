import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

/**
 * POST /api/recording - Upload a GPX recording to Vercel Blob
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gpx, name, sessionToken } = body;

    // Validate required fields
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

    // Generate a unique filename
    const timestamp = Date.now();
    const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
    const filename = `recordings/${sessionToken}/${timestamp}-${sanitizedName}.gpx`;

    // Upload to Vercel Blob
    const blob = await put(filename, gpx, {
      access: "public",
      contentType: "application/gpx+xml",
    });

    return NextResponse.json({
      success: true,
      blobUrl: blob.url,
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

    // List blobs with prefix matching the session token
    const { blobs } = await list({
      prefix: `recordings/${sessionToken}/`,
    });

    return NextResponse.json({
      recordings: blobs.map((blob) => ({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
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
