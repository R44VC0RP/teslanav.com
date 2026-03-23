import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isShutdownEnabled(): boolean {
  const shutdownValue = process.env.NEXT_PUBLIC_PROJECT_SHUTDOWN;
  if (!shutdownValue) {
    return true;
  }
  const disabledValues = new Set(["0", "false", "off", "no"]);
  return !disabledValues.has(shutdownValue.trim().toLowerCase());
}

export default function middleware(request: NextRequest): NextResponse {
  if (!isShutdownEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error:
          "TeslaNav is currently shut down. API access is temporarily disabled.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (pathname === "/") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
