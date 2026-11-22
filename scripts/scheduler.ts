/**
 * `npm run scheduler` — the scheduled work of a real installation, for a server without cron (the
 * `scheduler` service in compose.yaml). Never on a demonstration instance: its readings are frozen
 * in 2026, and the retention purge would delete them.
 *
 *   every 5 minutes   npm run telemetry:jobs   rules left behind, silences, escalation, retention
 *   once a day        npm run db:backup        consistent copy + restore check (EXPLOITATION.md §5)
 *
 * Backups older than BACKUP_KEEP_DAYS (default 14) are removed from this server; copying them off
 * the server is the operator's job (EXPLOITATION.md §5.2).
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const JOBS_EVERY_MS = 5 * 60_000;
const BACKUP_AT = process.env.BACKUP_AT ?? "02:30";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "backups";
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

function run(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "-s", script, ...(args.length ? ["--", ...args] : [])], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const moroccoDay = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "Africa/Casablanca" });
const moroccoTime = (at: Date) => at.toLocaleTimeString("en-GB", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function prune(now = Date.now()): void {
  let removed = 0;
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!/^biovolailles-.*\.db(\.manifest\.json)?$/.test(name)) continue;
    const file = path.join(BACKUP_DIR, name);
    if (now - statSync(file).mtimeMs > KEEP_DAYS * 86_400_000) {
      unlinkSync(file);
      removed++;
    }
  }
  if (removed) log(`sauvegardes : ${removed} fichier(s) de plus de ${KEEP_DAYS} jours retirés de ce serveur`);
}

let lastBackupDay: string | null = null;
let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const jobs = await run("telemetry:jobs");
    if (jobs !== 0) log(`tâches de télémétrie : échec (code ${jobs})`);
    const now = new Date();
    if (lastBackupDay !== moroccoDay(now) && moroccoTime(now) >= BACKUP_AT) {
      lastBackupDay = moroccoDay(now);
      const backup = await run("db:backup", [BACKUP_DIR]);
      log(backup === 0 ? "sauvegarde quotidienne : faite et vérifiée" : `sauvegarde quotidienne : ÉCHEC (code ${backup}) — voir EXPLOITATION.md §5`);
      prune();
    }
  } finally {
    busy = false;
  }
}

log(`planificateur démarré : tâches toutes les 5 min, sauvegarde quotidienne après ${BACKUP_AT} (heure du Maroc), conservation locale ${KEEP_DAYS} jours`);
void tick();
setInterval(() => void tick(), JOBS_EVERY_MS);
