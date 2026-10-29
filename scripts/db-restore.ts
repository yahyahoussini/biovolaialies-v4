import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * `npm run db:restore -- <backup.db> --confirm` — puts a backup in place of the local file database,
 * the application being stopped (EXPLOITATION.md §5.4). The backup is proven first; the live
 * database goes aside with its -wal and -shm files, never deleted. A hosted database is restored
 * through its provider, not by this command.
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  const confirmed = process.argv.includes("--confirm");
  const url = process.env.DATABASE_URL ?? "file:./data/db/biovolailles.db";
  if (!file || file.startsWith("--")) throw new Error("Indiquez la sauvegarde : npm run db:restore -- backups/biovolailles-….db --confirm");
  if (!url.startsWith("file:")) {
    throw new Error("DATABASE_URL désigne une base hébergée : la restaurer chez le fournisseur à partir du fichier, puis pointer DATABASE_URL dessus (EXPLOITATION.md §5.4).");
  }
  const path = await import("node:path");
  const live = path.resolve(url.slice("file:".length));
  const { readManifest, restoreFileDatabase } = await import("../services/ops/backup");
  const manifest = readManifest(file);
  console.log(`\nSauvegarde du ${new Date(manifest.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} → ${live}`);
  if (!confirmed) {
    console.log("\nRien n'a été modifié. Arrêtez l'application, puis relancez avec --confirm : la base en service sera mise de côté avec ses fichiers -wal et -shm, puis remplacée.\n");
    process.exitCode = 1;
    return;
  }
  const { asideDir, checks } = await restoreFileDatabase(file, manifest, live);
  console.log(`\nBase remplacée. L'ancienne est conservée dans ${asideDir}\n`);
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
  if (checks.some((c) => !c.ok)) {
    console.error("\nLa base restaurée ne passe pas ses contrôles : ne pas redémarrer l'application dessus.\n");
    process.exitCode = 1;
    return;
  }
  console.log("\nRestauration terminée. Redémarrer l'application, puis faire les contrôles d'EXPLOITATION.md §3.4.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
