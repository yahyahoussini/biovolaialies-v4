import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, describe, expect, it } from "vitest";
import { dbClient } from "../../data/db/client";
import { repositories } from "../../data/repositories";
import { recordAudit } from "../audit/record";
import { createBackup, readManifest, restoreFileDatabase, sha256File, verifyBackup, type BackupManifest } from "./backup";

const files: string[] = [];
const scratch = () => {
  const file = path.join(tmpdir(), `biovolailles-sauvegarde-${randomUUID()}.db`);
  files.push(file, `${file}.manifest.json`);
  return file;
};
afterAll(() => files.forEach((f) => rmSync(f, { force: true, recursive: true })));

/** Edits the backup file behind the manifest's back, then re-signs the bytes so only the content check can object. */
async function tamper(file: string, manifest: BackupManifest, sql: string): Promise<BackupManifest> {
  const client = createClient({ url: `file:${file.replace(/\\/g, "/")}` });
  await client.execute(sql);
  client.close();
  return { ...manifest, file: { ...manifest.file, sha256: sha256File(file) } };
}

describe("backup and verified restore", () => {
  it("copies every table consistently, and the restore check proves the copy", async () => {
    const org = await repositories.organizations.create({ name: "Sauvegarde", type: "INTERNAL" });
    await repositories.cooperatives.create({ organizationId: org.id, name: "Coop sauvegarde", region: "Fès-Meknès" });
    for (const i of [1, 2, 3]) await recordAudit({ actorId: null, entityType: "organization", entityId: org.id, field: "name", oldValue: null, newValue: `v${i}`, reason: "test", relatedLotId: null, relatedEventId: null });
    // Leads are kept out of the demo reset, never out of a backup.
    await repositories.leads.create({ company: "Élevage test", contactName: "Prospect", email: "prospect@example.test", phone: null, activity: "ELEVAGE", capacity: null, need: "Démonstration", consent: true, consentVersion: "v1" });

    const file = scratch();
    const manifest = await createBackup(dbClient, file, new Date("2026-10-29T02:00:00.000Z"));
    expect(readManifest(file)).toEqual(manifest);
    expect(manifest.tables.organizations).toBeGreaterThanOrEqual(1);
    expect(manifest.tables.leads).toBeGreaterThanOrEqual(1);
    expect(manifest.tables.ledger_events).toBe((await repositories.ledger.listAll()).length);
    expect(manifest.ledgerHead?.seq).toBe(manifest.tables.ledger_events);

    const report = await verifyBackup(file, manifest);
    expect(report.checks.map((c) => [c.label, c.ok])).toEqual([
      ["Empreinte du fichier", true],
      ["Intégrité SQLite", true],
      ["Références entre tables", true],
      ["Lignes par table", true],
      ["Journal chaîné", true],
      ["Migrations", true],
    ]);
    expect(report.ok).toBe(true);
  });

  it("refuses a copy whose ledger, rows or bytes changed after the backup", async () => {
    await recordAudit({ actorId: null, entityType: "organization", entityId: "x", field: null, oldValue: null, newValue: "w", reason: "test", relatedLotId: null, relatedEventId: null });
    const file = scratch();
    const manifest = await createBackup(dbClient, file);

    // An edited ledger entry: the chain no longer recomputes.
    const edited = await tamper(file, manifest, "UPDATE ledger_events SET payload = '{\"edited\":true}' WHERE seq = 1");
    const ledger = await verifyBackup(file, edited);
    expect(ledger.ok).toBe(false);
    expect(ledger.checks.find((c) => c.label === "Journal chaîné")).toMatchObject({ ok: false, detail: expect.stringContaining("n° 1") });

    // A row gone.
    const fresh = scratch();
    const m2 = await createBackup(dbClient, fresh);
    const missing = await tamper(fresh, m2, "DELETE FROM cooperatives");
    expect((await verifyBackup(fresh, missing)).checks.find((c) => c.label === "Lignes par table")).toMatchObject({ ok: false, detail: expect.stringContaining("cooperatives") });

    // Bytes changed and the manifest not re-signed: refused on the fingerprint alone.
    const third = scratch();
    const m3 = await createBackup(dbClient, third);
    appendFileSync(third, Buffer.from([0]));
    expect((await verifyBackup(third, m3)).checks[0]).toMatchObject({ label: "Empreinte du fichier", ok: false });
  });

  it("restores a file database without letting a leftover write-ahead log replay over it", async () => {
    const backup = scratch();
    const manifest = await createBackup(dbClient, backup);
    // A live database in WAL mode whose last writes still sit in its -wal file, as a stopped server leaves it.
    const running = mkdtempSync(path.join(tmpdir(), "biovolailles-en-service-"));
    const stopped = mkdtempSync(path.join(tmpdir(), "biovolailles-arretee-"));
    files.push(running, stopped);
    const live = path.join(running, "biovolailles.db");
    copyFileSync(backup, live);
    const server = createClient({ url: `file:${live.replace(/\\/g, "/")}` });
    await server.execute("PRAGMA journal_mode = WAL");
    await server.execute("INSERT INTO organizations (id, name, type, created_at) VALUES ('apres-sauvegarde', 'Saisie après la sauvegarde', 'INTERNAL', '2026-10-29T03:00:00.000Z')");
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(`${live}${suffix}`)) copyFileSync(`${live}${suffix}`, path.join(stopped, `biovolailles.db${suffix}`));
    server.close();
    const target = path.join(stopped, "biovolailles.db");
    expect(existsSync(`${target}-wal`)).toBe(true);

    const { asideDir, checks } = await restoreFileDatabase(backup, manifest, target, new Date("2026-10-29T03:10:00.000Z"));
    expect(checks.every((c) => c.ok)).toBe(true);
    // The restored database holds the backup, not the replayed log…
    const restored = createClient({ url: `file:${target.replace(/\\/g, "/")}` });
    expect((await restored.execute("SELECT count(*) AS n FROM organizations WHERE id = 'apres-sauvegarde'")).rows[0].n).toBe(0);
    expect(Number((await restored.execute("SELECT count(*) AS n FROM organizations")).rows[0].n)).toBe(manifest.tables.organizations);
    restored.close();
    // …and the replaced one is kept whole, its log beside it.
    expect(readdirSync(asideDir).sort()).toEqual(["biovolailles.db", "biovolailles.db-shm", "biovolailles.db-wal"]);
    const aside = createClient({ url: `file:${path.join(asideDir, "biovolailles.db").replace(/\\/g, "/")}` });
    expect((await aside.execute("SELECT count(*) AS n FROM organizations WHERE id = 'apres-sauvegarde'")).rows[0].n).toBe(1);
    aside.close();
  });
});
