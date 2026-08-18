import type { NextConfig } from "next";

const shutdownRaw = process.env.NEXT_PUBLIC_PROJECT_SHUTDOWN;
const isProjectShutdown =
  !shutdownRaw || !["0", "false", "off", "no"].includes(shutdownRaw.trim().toLowerCase());

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    if (isProjectShutdown) {
      return [];
    }

    return [
      // PostHog rewrites
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      // DataFast rewrites
      {
        source: "/js/script.js",
        destination: "https://datafa.st/js/script.js",
      },
      {
        source: "/api/events",
        destination: "https://datafa.st/api/events",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
