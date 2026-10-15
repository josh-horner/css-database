/** Wires real services for apps/api and apps/worker from the environment. */
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { createDb, databaseUrl, loadEnv } from "@css/db";
import { createIntegrations } from "@css/integrations";
import { loadConfig } from "./config";
import type { Services } from "./context";

export const QUEUES = ["ai.reply"] as const;

export async function createServices(repoRoot: string): Promise<Services & { boss: PgBoss; close: () => Promise<void> }> {
  loadEnv();
  const url = databaseUrl();
  const db = createDb(url);
  const boss = new PgBoss(url);
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();
  for (const q of QUEUES) await boss.createQueue(q);
  return {
    db,
    boss,
    config: loadConfig(),
    integrations: createIntegrations(process.env, resolve(repoRoot)),
    enqueue: async (name, data) => {
      await boss.send(name, data);
    },
    close: async () => {
      await boss.stop();
      await db.$sql.end();
    },
  };
}
