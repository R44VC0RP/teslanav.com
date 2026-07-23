import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { recordAnalyticsRequest } from "@/lib/db";

function normalizeRoute(pathname: string): string | null {
  if (
    pathname === "/api/analytics" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/_next/") ||
    /\.(?:css|js|map|png|jpe?g|gif|webp|svg|ico|woff2?|xml|txt|mp3)$/i.test(pathname)
  ) {
    return null;
  }
  if (/^\/api\/recording\/[^/]+$/.test(pathname)) {
    return "/api/recording/[id]";
  }
  return pathname || "/";
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const publicHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (publicHost?.toLowerCase() === "www.teslanav.com") {
    const canonical = request.nextUrl.clone();
    canonical.protocol = "https";
    canonical.hostname = "teslanav.com";
    canonical.port = "";
    return NextResponse.redirect(canonical, 308);
  }

  const route = normalizeRoute(request.nextUrl.pathname);
  if (route) {
    event.waitUntil(
      Promise.resolve().then(() => {
        try {
          recordAnalyticsRequest(route, request.method);
        } catch (error) {
          console.error("[Analytics] request counter failed:", error);
        }
      })
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
