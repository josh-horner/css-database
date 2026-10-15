import type { NextConfig } from "next";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

if (existsSync("../../.env")) loadEnvFile("../../.env");
const api = process.env.API_URL ?? "http://localhost:4100";

const config: NextConfig = {
  transpilePackages: ["@css/ui", "@css/domain"],
  async rewrites() {
    return [
      { source: "/trpc/:path*", destination: `${api}/trpc/:path*` },
      { source: "/photos/:path*", destination: `${api}/photos/:path*` },
      { source: "/portal/uploads", destination: `${api}/portal/uploads` },
    ];
  },
};

export default config;
