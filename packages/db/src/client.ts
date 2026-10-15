import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./env";
import * as schema from "./schema";

export function createDb(url = databaseUrl()) {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return Object.assign(db, { $sql: sql });
}

export type Db = ReturnType<typeof createDb>;
/** A transaction handle has the same query API as the db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
