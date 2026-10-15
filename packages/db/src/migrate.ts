import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type Db } from "./client";

export const MIGRATIONS_FOLDER = new URL("../migrations", import.meta.url).pathname;

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb();
  await runMigrations(db);
  await db.$sql.end();
  console.log("migrations applied");
}
