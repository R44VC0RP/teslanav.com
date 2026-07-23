import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained deployment: single `node server.js` in Docker
  output: "standalone",
  // Avoid a parent-directory package-lock making Next infer /Users/vogel as
  // the workspace root (which also bloats/weakens standalone tracing).
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  // better-sqlite3 is a native module - keep it external to bundling
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
