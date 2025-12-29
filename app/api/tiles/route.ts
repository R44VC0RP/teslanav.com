import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { redis, CACHE_KEYS } from "@/lib/redis";

// Cache tiles for 15 days
const TILE_CACHE_DAYS = 15;
const TILE_CACHE_SECONDS = TILE_CACHE_DAYS * 24 * 60 * 60;

// Mapbox token
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Allowed Mapbox tile URL patterns (security - prevent proxying arbitrary URLs)
const ALLOWED_PATTERNS = [
  /^https:\/\/api\.mapbox\.com\/v4\//,
  /^https:\/\/api\.mapbox\.com\/styles\/v1\//,
  /^https:\/\/api\.mapbox\.com\/fonts\//,
  /^https:\/\/a\.tiles\.mapbox\.com\//,
  /^https:\/\/b\.tiles\.mapbox\.com\//,
  /^https:\/\/c\.tiles\.mapbox\.com\//,
  /^https:\/\/d\.tiles\.mapbox\.com\//,
];

function isAllowedUrl(url: string): boolean {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(url));
}

// Generate a cache key from the tile URL
function getCacheKey(url: string): string {
  // Remove the access token from the URL for consistent caching
  const urlWithoutToken = url.replace(/access_token=[^&]+/, "");
  // Create a simple hash-like key
  const encoded = Buffer.from(urlWithoutToken).toString("base64url");
  return `tiles/${encoded}`;
}

// Get content type from URL
function getContentType(url: string): string {
  if (url.includes(".pbf") || url.includes("vector.pbf")) {
    return "application/x-protobuf";
  }
  if (url.includes(".png")) {
    return "image/png";
  }
  if (url.includes(".jpg") || url.includes(".jpeg")) {
    return "image/jpeg";
  }
  if (url.includes(".webp")) {
    return "image/webp";
  }
  if (url.includes("/fonts/") && url.includes(".pbf")) {
    return "application/x-protobuf";
  }
  // Default for vector tiles
  return "application/x-protobuf";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tileUrl = searchParams.get("url");

  if (!tileUrl) {
    return NextResponse.json({ error: "Missing tile URL" }, { status: 400 });
  }

  // Security check - only allow Mapbox URLs
  if (!isAllowedUrl(tileUrl)) {
    return NextResponse.json({ error: "Invalid tile URL" }, { status: 403 });
  }

  const cacheKey = getCacheKey(tileUrl);
  const redisMetaKey = `${CACHE_KEYS.TILE_CACHE}${cacheKey}`;

  try {
    // Check Redis for cached blob URL and expiry
    const cachedMeta = await redis.get<{ blobUrl: string; expires: number }>(redisMetaKey);

    if (cachedMeta && cachedMeta.expires > Date.now()) {
      // We have a valid cache entry, try to fetch from Blob storage
      try {
        const blobResponse = await fetch(cachedMeta.blobUrl);
        if (blobResponse.ok) {
          const tileData = await blobResponse.arrayBuffer();
          const contentType = getContentType(tileUrl);

          return new NextResponse(tileData, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": `public, max-age=${TILE_CACHE_SECONDS}, stale-while-revalidate=86400`,
              "X-Tile-Cache": "HIT",
              "X-Cache-Expires": new Date(cachedMeta.expires).toISOString(),
            },
          });
        }
      } catch {
        // Blob fetch failed, fall through to re-fetch from Mapbox
        console.log("[Tile Cache] Blob fetch failed, re-fetching from Mapbox");
      }
    }

    // Cache miss or expired - fetch from Mapbox
    const mapboxUrl = tileUrl.includes("access_token=")
      ? tileUrl
      : `${tileUrl}${tileUrl.includes("?") ? "&" : "?"}access_token=${MAPBOX_TOKEN}`;

    const mapboxResponse = await fetch(mapboxUrl, {
      headers: {
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    if (!mapboxResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch tile from Mapbox", status: mapboxResponse.status },
        { status: mapboxResponse.status }
      );
    }

    const tileData = await mapboxResponse.arrayBuffer();
    const contentType = getContentType(tileUrl);

    // Store in Vercel Blob (async, don't block response)
    const expiresAt = Date.now() + TILE_CACHE_SECONDS * 1000;

    // Upload to Blob storage in background
    (async () => {
      try {
        const blob = await put(cacheKey, Buffer.from(tileData), {
          access: "public",
          contentType,
          addRandomSuffix: false,
        });

        // Store blob URL in Redis with expiry metadata
        await redis.set(
          redisMetaKey,
          { blobUrl: blob.url, expires: expiresAt },
          { ex: TILE_CACHE_SECONDS + 3600 } // Keep Redis entry slightly longer
        );
      } catch (err) {
        console.error("[Tile Cache] Failed to cache tile:", err);
      }
    })();

    return new NextResponse(tileData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${TILE_CACHE_SECONDS}, stale-while-revalidate=86400`,
        "X-Tile-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("[Tile Cache] Error:", error);

    // On any error, try to passthrough directly to Mapbox
    try {
      const mapboxUrl = tileUrl.includes("access_token=")
        ? tileUrl
        : `${tileUrl}${tileUrl.includes("?") ? "&" : "?"}access_token=${MAPBOX_TOKEN}`;

      const fallbackResponse = await fetch(mapboxUrl);
      if (fallbackResponse.ok) {
        const tileData = await fallbackResponse.arrayBuffer();
        return new NextResponse(tileData, {
          status: 200,
          headers: {
            "Content-Type": getContentType(tileUrl),
            "Cache-Control": "public, max-age=3600",
            "X-Tile-Cache": "ERROR-PASSTHROUGH",
          },
        });
      }
    } catch {
      // Final fallback failed
    }

    return NextResponse.json({ error: "Tile proxy error" }, { status: 500 });
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
