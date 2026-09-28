import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the local demo (next dev) run alongside a production build of the MST server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native / Node-only modules used by API routes and server components.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
