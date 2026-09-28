import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only modules used by API routes and server components.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
