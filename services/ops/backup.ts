import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client, type InValue } from "@libsql/client";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import journal from "../../data/db/migrations/meta/_journal.json";
import { ledgerEvents } from "../../data/db/schema";
import { verifyChain } from "../../domain/ledger/hash-chain";
import type { LedgerEvent } from "../../domain/ledger/types";

/**
 * Backups that are proven restorable (document 3, lot 14: "sans cela le système n'est pas
 * exploitable par un tiers"). A backup is a plain SQLite file built from the migrations and filled
 * from the live database inside one read transaction, so it is consistent even while the
 * application writes. Its manifest records what it should contain; the restore check restores it
 * into a scratch copy and proves it: same bytes, sound SQLite, no broken reference, the rows
 * announced, the hash-chained ledger intact up to the recorded head, and the current migrations
 * applying cleanly on top. A backup nobody has restored is a hope, not a backup.
 */

export const MIGRATIONS_FOLDER = "./data/db/migrations";
const PAGE = 2_000;

export interface BackupManifest {
  format: 1;
  createdAt: string;
  migrations: { applied: number; last: string | null };
  /** Rows per table in the backup. */
  tables: Record<string, number>;
  ledgerHead: { seq: number; hash: string } | null;
  file: { name: string; bytes: number; sha256: string };
}

export interface RestoreCheck {
  label: string;
  ok: boolean;
  detail: string;
}

const fileUrl = (p: string) => `file:${path.resolve(p).replace(/\\/g, "/")}`;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const knownMigrations = () => journal.entries.length;
const lastKnownTag = () => journal.entries.at(-1)?.tag ?? null;

async function migrationsApplied(client: Client): Promise<number> {
  try {
    const r = await client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

async function userTables(client: Client): Promise<string[]> {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return r.rows.map((row) => String(row.name)).filter((n) => !n.startsWith("sqlite_") && !n.startsWith("__"));
}

/**
 * Copies the live database into `outPath` and writes `<outPath>.manifest.json`. Refuses a database
 * whose migrations differ from this version of the application: back up with the version deployed.
 */
export async function createBackup(source: Client, outPath: string, now = new Date()): Promise<BackupManifest> {
  const applied = await migrationsApplied(source);
  if (applied !== knownMigrations()) {
    throw new Error(`La base a ${applied} migration(s) appliquée(s), cette version de l'application en connaît ${knownMigrations()} : sauvegardez avec la version déployée.`);
  }
  rmSync(outPath, { force: true });
  const target = createClient({ url: fileUrl(outPath) });
  const tables: Record<string, number> = {};
  try {
    await migrate(drizzle(target), { migrationsFolder: MIGRATIONS_FOLDER });
    // Rows arrive table by table, in name order: references are checked once everything is in.
    await target.execute("PRAGMA foreign_keys = OFF");
    const tx = await source.transaction("read");
    try {
      for (const table of await userTables(target)) {
        const columns = (await target.execute(`PRAGMA table_info(${quote(table)})`)).rows.map((r) => String(r.name));
        const insert = `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
        let after = 0;
        let count = 0;
        for (;;) {
          const page = await tx.execute({ sql: `SELECT rowid AS "__rowid", ${columns.map(quote).join(", ")} FROM ${quote(table)} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`, args: [after] });
          if (page.rows.length === 0) break;
          await target.batch(
            page.rows.map((row) => ({ sql: insert, args: columns.map((c) => row[c] as InValue) })),
            "write"
          );
          after = Number(page.rows[page.rows.length - 1].__rowid);
          count += page.rows.length;
        }
        tables[table] = count;
      }
    } finally {
      tx.close();
    }
    const head = await target.execute("SELECT seq, hash FROM ledger_events ORDER BY seq DESC LIMIT 1");
    const ledgerHead = head.rows[0] ? { seq: Number(head.rows[0].seq), hash: String(head.rows[0].hash) } : null;
    target.close();
    const manifest: BackupManifest = {
      format: 1,
      createdAt: now.toISOString(),
      migrations: { applied, last: lastKnownTag() },
      tables,
      ledgerHead,
      file: { name: path.basename(outPath), bytes: statSync(outPath).size, sha256: sha256File(outPath) },
    };
    writeFileSync(`${outPath}.manifest.json`, JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (error) {
    target.close();
    rmSync(outPath, { force: true });
    throw error;
  }
}

/**
 * Restores the backup into a scratch copy and proves it usable. The original file is never
 * opened for writing.
 */
export async function verifyBackup(file: string, manifest: BackupManifest): Promise<{ ok: boolean; checks: RestoreCheck[] }> {
  const checks: RestoreCheck[] = [];
  const check = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

  const digest = sha256File(file);
  check("Empreinte du fichier", digest === manifest.file.sha256, digest === manifest.file.sha256 ? `SHA-256 identique au manifeste (${digest.slice(0, 16)}…).` : `SHA-256 ${digest.slice(0, 16)}… au lieu de ${manifest.file.sha256.slice(0, 16)}… : le fichier a changé depuis la sauvegarde.`);

  const scratch = path.join(tmpdir(), `biovolailles-restauration-${randomUUID()}.db`);
  copyFileSync(file, scratch);
  const client = createClient({ url: fileUrl(scratch) });
  try {
    const integrity = String((await client.execute("PRAGMA integrity_check")).rows[0]?.[0] ?? "");
    check("Intégrité SQLite", integrity === "ok", integrity === "ok" ? "PRAGMA integrity_check : ok." : `PRAGMA integrity_check : ${integrity}`);

    const orphans = (await client.execute("PRAGMA foreign_key_check")).rows.length;
    check("Références entre tables", orphans === 0, orphans === 0 ? "Aucune référence vers une ligne absente." : `${orphans} référence(s) vers des lignes absentes.`);

    const counted: Record<string, number> = {};
    for (const table of await userTables(client)) counted[table] = Number((await client.execute(`SELECT count(*) AS n FROM ${quote(table)}`)).rows[0]?.n ?? 0);
    const differing = Object.entries(manifest.tables).filter(([t, n]) => counted[t] !== n);
    const total = Object.values(counted).reduce((a, b) => a + b, 0);
    check(
      "Lignes par table",
      differing.length === 0,
      differing.length === 0 ? `${Object.keys(manifest.tables).length} tables, ${total.toLocaleString("fr-FR")} lignes, comme annoncé.` : differing.map(([t, n]) => `${t} : ${counted[t] ?? "absente"} au lieu de ${n}`).join(" ; ")
    );

    const events = (await drizzle(client).select().from(ledgerEvents).orderBy(asc(ledgerEvents.seq))) as LedgerEvent[];
    const chain = verifyChain(events);
    const headMatches = manifest.ledgerHead === null ? events.length === 0 : chain.headSeq === manifest.ledgerHead.seq && chain.headHash === manifest.ledgerHead.hash;
    check(
      "Journal chaîné",
      chain.ok && headMatches,
      !chain.ok ? `Chaîne rompue au n° ${chain.brokenAtSeq} : ${chain.reason}` : headMatches ? `${chain.count} événements, tête n° ${chain.headSeq} identique à celle de la sauvegarde.` : `Tête n° ${chain.headSeq} au lieu du n° ${manifest.ledgerHead?.seq} enregistré.`
    );

    // The backup must open with the application as it is now: pending migrations apply on top.
    const before = await migrationsApplied(client);
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      const after = await migrationsApplied(client);
      check("Migrations", after === knownMigrations(), before === after ? `Schéma à jour (${after} migrations).` : `${after - before} migration(s) appliquée(s) sur la copie restaurée, sans erreur.`);
    } catch (error) {
      check("Migrations", false, `Les migrations actuelles échouent sur la copie : ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    client.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${scratch}${suffix}`, { force: true });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Puts a proven backup in place of a file database (the application stopped). The live file goes
 * aside with its -wal and -shm files: a write-ahead log left next to the restored file would be
 * replayed onto it at the next opening, silently bringing back the state being replaced. Nothing is
 * deleted; the set aside can be put back by hand.
 */
export async function restoreFileDatabase(backupFile: string, manifest: BackupManifest, liveFile: string, now = new Date()): Promise<{ asideDir: string; checks: RestoreCheck[] }> {
  const proof = await verifyBackup(backupFile, manifest);
  if (!proof.ok) throw new Error(`La sauvegarde ne passe pas la restauration d'essai (${proof.checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}) : restauration refusée.`);
  const asideDir = path.join(path.dirname(liveFile), `avant-restauration-${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`);
  mkdirSync(asideDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${liveFile}${suffix}`;
    if (existsSync(f)) renameSync(f, path.join(asideDir, path.basename(f)));
  }
  copyFileSync(backupFile, liveFile);

  const checks: RestoreCheck[] = [];
  const client = createClient({ url: fileUrl(liveFile) });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const integrity = String((await client.execute("PRAGMA integrity_check")).rows[0]?.[0] ?? "");
    checks.push({ label: "Intégrité SQLite", ok: integrity === "ok", detail: `PRAGMA integrity_check : ${integrity}.` });
    const chain = verifyChain((await drizzle(client).select().from(ledgerEvents).orderBy(asc(ledgerEvents.seq))) as LedgerEvent[]);
    const headMatches = manifest.ledgerHead === null ? chain.count === 0 : chain.headSeq === manifest.ledgerHead.seq && chain.headHash === manifest.ledgerHead.hash;
    checks.push({ label: "Journal chaîné", ok: chain.ok && headMatches, detail: chain.ok ? `${chain.count} événements, tête n° ${chain.headSeq}${headMatches ? ", celle de la sauvegarde." : `, au lieu du n° ${manifest.ledgerHead?.seq}.`}` : `Chaîne rompue au n° ${chain.brokenAtSeq}.` });
    const applied = await migrationsApplied(client);
    checks.push({ label: "Migrations", ok: applied === knownMigrations(), detail: `${applied} migrations appliquées sur ${knownMigrations()}.` });
  } finally {
    client.close();
  }
  return { asideDir, checks };
}

export function readManifest(file: string): BackupManifest {
  const manifest = JSON.parse(readFileSync(`${file}.manifest.json`, "utf8")) as BackupManifest;
  if (manifest.format !== 1) throw new Error("Manifeste de sauvegarde d'un format inconnu.");
  return manifest;
}
