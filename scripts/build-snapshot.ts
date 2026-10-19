/**
 * Rebuilds the demo snapshot shipped with the app (data/demo/snapshot.db.gz): a fresh
 * database, every migration, the full seed, then VACUUM and gzip. Run after any change to the
 * schema or the seed: `npm run demo:snapshot`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";

const root = path.resolve(__dirname, "..");
const build = path.join(root, "data", "demo", "snapshot.build.db");
const target = path.join(root, "data", "demo", "snapshot.db.gz");
for (const f of [build, `${build}-wal`, `${build}-shm`]) if (existsSync(f)) rmSync(f);

const env = { ...process.env, DATABASE_URL: `file:${build.split(path.sep).join("/")}`, DATABASE_AUTH_TOKEN: "" };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["drizzle-kit", "migrate"], { cwd: root, env, stdio: "inherit" });
execFileSync(npx, ["tsx", "data/seed/run.ts"], { cwd: root, env, stdio: "inherit" });

async function main() {
  const client = createClient({ url: env.DATABASE_URL });
  // Back to a single self-contained file: no WAL beside it, no free pages inside it.
  await client.execute("PRAGMA wal_checkpoint(TRUNCATE);");
  await client.execute("PRAGMA journal_mode = DELETE;");
  await client.execute("VACUUM;");
  client.close();
  writeFileSync(target, gzipSync(readFileSync(build), { level: 9 }));
  console.log(`Snapshot: ${(statSync(build).size / 1e6).toFixed(1)} MB → ${(statSync(target).size / 1e6).toFixed(1)} MB gzip (${path.relative(root, target)})`);
  for (const f of [build, `${build}-wal`, `${build}-shm`]) if (existsSync(f)) rmSync(f);
}

void main();
