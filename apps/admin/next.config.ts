import type { NextConfig } from "next";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

if (existsSync("../../.env")) loadEnvFile("../../.env");
const api = process.env.API_URL ?? "http://localhost:4100";

const config: NextConfig = {
  transpilePackages: ["@css/ui", "@css/domain"],
  // Same-origin proxy to apps/api keeps the staff session cookie first-party.
  async rewrites() {
    return [
      { source: "/trpc/:path*", destination: `${api}/trpc/:path*` },
      { source: "/auth/:path*", destination: `${api}/auth/:path*` },
      { source: "/photos/:path*", destination: `${api}/photos/:path*` },
      { source: "/claim-photos/:path*", destination: `${api}/claim-photos/:path*` },
    ];
  },
};

export default config;
