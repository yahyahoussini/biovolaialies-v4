import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { env } from "../../lib/env";
import * as schema from "./schema";

/**
 * Singleton libSQL client + Drizzle instance, cached on `globalThis` so Next.js
 * dev-mode module reloads don't open a new SQLite connection on every edit.
 * No `import "server-only"` — the seed/reset scripts (run via `tsx`, outside Next's
 * bundler) import this module directly; see lib/env.ts for the full reasoning.
 */
declare global {
  var __biovolailles_db__: { client: Client; db: LibSQLDatabase<typeof schema> } | undefined;
}

/**
 * Seeded demo database committed to the repo, gzipped, and traced into the deployment
 * (next.config.ts). Built by `npm run demo:snapshot`. Compressed because telemetry made it
 * several megabytes, and a binary in git is paid again at every regeneration.
 */
const SNAPSHOT_SOURCE = path.join(process.cwd(), "data", "demo", "snapshot.db.gz");

/**
 * Where the database actually lives for this process. In snapshot mode (lib/env.ts) the
 * bundled file sits on a read-only filesystem, and SQLite needs to write even to *read* safely
 * (journals, locks) — so the first use copies it into the platform temp directory, the one
 * writable place a serverless function has. Later uses in the same warm instance find the copy
 * already there and keep it, writes included; a cold start begins again from the pristine
 * snapshot. Synchronous on purpose: this runs once at module evaluation, before any query can
 * race it.
 */
function resolveDatabaseUrl(): string {
  if (!env.DATABASE_SNAPSHOT) return env.DATABASE_URL;
  const target = path.join(tmpdir(), "biovolailles-demo.db");
  if (!existsSync(target)) writeFileSync(target, gunzipSync(readFileSync(SNAPSHOT_SOURCE)));
  // Forward slashes: libSQL parses `file:` URLs as URLs, and a Windows backslash path fails there.
  return `file:${target.split(path.sep).join("/")}`;
}

const databaseUrl = resolveDatabaseUrl();

/** A local file database vs. a remote libSQL/Turso one — the two differ in how FKs get enabled. */
const isLocalFileDatabase = databaseUrl.startsWith("file:");

/** Foreign keys are OFF by default per SQLite connection — must be enabled explicitly. */
export async function enableForeignKeys(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON;");
}

/**
 * Write-ahead log with normal sync for a local file database: a commit no longer waits for a
 * full disk flush of the main file. Telemetry writes a few small transactions per gateway
 * message; in the default rollback-journal mode each one cost a flush, and a catch-up spent
 * most of its time there (measured: seed 85 s → 36 s). NORMAL in WAL mode loses no committed
 * transaction on a process crash; on a power cut it can lose the last few, never corrupt the file.
 */
export async function tuneLocalDatabase(client: Client): Promise<void> {
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA synchronous = NORMAL;");
}

function createDb() {
  const client = createClient({ url: databaseUrl, authToken: env.DATABASE_AUTH_TOKEN });
  if (isLocalFileDatabase) {
    // Fire-and-forget: a local connection executes commands in submission order, so every
    // later query is already covered. `.catch` because an unhandled rejection here would
    // take the process down on a problem the next real query reports far more clearly.
    void enableForeignKeys(client).catch(() => {});
    void tuneLocalDatabase(client).catch(() => {});
  }
  // A remote libSQL/Turso connection is deliberately left alone: it is a pool of short-lived
  // HTTP requests, not one long-lived connection, so a one-shot PRAGMA would apply to a single
  // request and then be gone. Turso enforces foreign keys server-side instead.
  const db = drizzle(client, { schema });
  return { client, db };
}

const instance = globalThis.__biovolailles_db__ ?? createDb();
if (env.NODE_ENV !== "production") {
  globalThis.__biovolailles_db__ = instance;
}

export const db = instance.db;
export const dbClient = instance.client;
