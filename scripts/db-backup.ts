import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * `npm run db:backup [-- <directory>]` — a consistent copy of the database the deployment uses,
 * with its manifest, then the restore check run on it at once: a backup is reported done only
 * once it has been restored and proven (EXPLOITATION.md, "Sauvegardes"). Works on a local file
 * database and on a hosted libSQL one; prints the host, never the token.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("DATABASE_URL n'est pas défini : indiquez la base à sauvegarder.");
  const dir = process.argv[2] ?? "backups";
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = path.join(dir, `biovolailles-${stamp}.db`);

  const { createClient } = await import("@libsql/client");
  const { createBackup, verifyBackup } = await import("../services/ops/backup");
  const host = url.startsWith("file:") ? url : url.replace(/^\w+:\/\//, "").split("/")[0];
  console.log(`\nBase sauvegardée : ${host}`);
  const source = createClient({ url, authToken });
  const manifest = await createBackup(source, file);
  source.close();
  const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Sauvegarde : ${file} (${(manifest.file.bytes / 1024 / 1024).toFixed(1)} Mo, ${rows.toLocaleString("fr-FR")} lignes, journal chaîné jusqu'au n° ${manifest.ledgerHead?.seq ?? 0})`);
  console.log(`SHA-256 : ${manifest.file.sha256}\n`);

  console.log("Restauration d'essai sur une copie…");
  const report = await verifyBackup(file, manifest);
  for (const c of report.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
  if (!report.ok) {
    console.error("\nLa sauvegarde ne se restaure pas correctement : ne pas la conserver comme sauvegarde valide.\n");
    process.exitCode = 1;
    return;
  }
  console.log("\nSauvegarde restaurée et vérifiée. À copier hors du serveur (voir EXPLOITATION.md).\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
