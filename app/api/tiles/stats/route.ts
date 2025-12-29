import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get blob storage stats
    const { blobs } = await list({ prefix: "tiles/" });
    
    // Calculate total size and count
    let totalSize = 0;
    let tileCount = 0;
    const oldestTile = blobs.length > 0 
      ? new Date(Math.min(...blobs.map(b => new Date(b.uploadedAt).getTime())))
      : null;
    const newestTile = blobs.length > 0
      ? new Date(Math.max(...blobs.map(b => new Date(b.uploadedAt).getTime())))
      : null;

    for (const blob of blobs) {
      totalSize += blob.size;
      tileCount++;
    }

    // Get some sample Redis cache entries to check hit rates
    // (This is approximate - for detailed stats you'd want to track hits/misses separately)
    const stats = {
      tileCount,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      oldestTile: oldestTile?.toISOString() || null,
      newestTile: newestTile?.toISOString() || null,
      cacheDurationDays: 15,
      estimatedMonthlySavings: `${tileCount} tiles cached = potential ${tileCount} fewer Mapbox requests`,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("[Tile Stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to get tile cache stats" },
      { status: 500 }
    );
  }
}
