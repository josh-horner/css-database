import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load the repo-root .env once (Node 22+ built-in), without overriding real env vars. */
export function loadEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = resolve(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
    dir = resolve(dir, "..");
  }
}

export function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  // The legacy production copy must never be written to by this codebase.
  if (/\/csstorage(\?|$)/.test(url)) throw new Error("Refusing to use the legacy production copy (csstorage)");
  return url;
}
