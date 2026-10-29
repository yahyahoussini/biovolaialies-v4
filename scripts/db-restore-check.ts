/**
 * `npm run db:restore-check -- <backup.db>` — restores a backup into a scratch copy and proves it:
 * fingerprint, SQLite integrity, references, rows, hash-chained ledger, current migrations. Run it
 * on any backup before relying on it, and monthly on the latest one (EXPLOITATION.md).
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("Indiquez le fichier de sauvegarde : npm run db:restore-check -- backups/biovolailles-….db");
  const { readManifest, verifyBackup } = await import("../services/ops/backup");
  const manifest = readManifest(file);
  console.log(`\nSauvegarde du ${new Date(manifest.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} — ${file}\n`);
  const report = await verifyBackup(file, manifest);
  for (const c of report.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
  console.log(report.ok ? "\nRestauration vérifiée : cette sauvegarde est utilisable.\n" : "\nRestauration en échec : cette sauvegarde n'est pas fiable.\n");
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
