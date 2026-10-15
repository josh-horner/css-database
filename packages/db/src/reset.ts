/** Drops and recreates the public schema. Only for local dev/test databases. */
import postgres from "postgres";
import { databaseUrl } from "./env";

const url = databaseUrl();
const name = new URL(url).pathname.slice(1);
if (!/_(dev|test)$/.test(name)) throw new Error(`Refusing to reset "${name}": only *_dev or *_test databases`);
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`drop schema if exists public cascade`;
await sql`drop schema if exists drizzle cascade`;
await sql`drop schema if exists pgboss cascade`;
await sql`create schema public`;
await sql.end();
console.log(`reset ${name}`);
