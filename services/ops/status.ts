import { dbClient } from "../../data/db/client";
import journal from "../../data/db/migrations/meta/_journal.json";
import { repositories } from "../../data/repositories";
import { verifyChain } from "../../domain/ledger/hash-chain";
import { AuthorizationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { RAW_RETENTION_DAYS } from "../../domain/telemetry/aggregate";
import { env } from "../../lib/env";
import type { Session } from "../auth/session";

/**
 * What an operator who did not build the platform must watch (document 3, lot 14). Each signal is
 * measured on the live database, never asserted; a warning says what has probably stopped and what
 * to run. The ones the platform cannot see for itself — backups, anchors kept elsewhere — are left
 * to the operations manual rather than shown as green.
 */

export type SignalStatus = "OK" | "WARN" | "FAIL";

export interface OpsSignal {
  key: string;
  label: string;
  status: SignalStatus;
  detail: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Beyond this, the rules are behind the readings: the scheduled jobs are probably not running. */
const RULES_LAG_TOLERANCE_MS = 30 * 60_000;
const fmtAge = (ms: number) => (ms >= DAY ? `${Math.round(ms / DAY)} j` : ms >= HOUR ? `${Math.round(ms / HOUR)} h` : `${Math.round(ms / 60_000)} min`);

export async function operationsStatus(session: Session, now = new Date()): Promise<OpsSignal[]> {
  if (!can(session, "VIEW", "SETTINGS")) throw new AuthorizationError();
  const out: OpsSignal[] = [];
  const add = (key: string, label: string, status: SignalStatus, detail: string) => out.push({ key, label, status, detail });

  try {
    await dbClient.execute("SELECT 1");
    add("database", "Base de données", "OK", "Joignable.");
  } catch (error) {
    add("database", "Base de données", "FAIL", error instanceof Error ? error.message : "Injoignable.");
    return out;
  }

  const applied = Number((await dbClient.execute("SELECT count(*) AS n FROM __drizzle_migrations")).rows[0]?.n ?? 0);
  const expected = journal.entries.length;
  add(
    "schema",
    "Version du schéma",
    applied === expected ? "OK" : "FAIL",
    applied === expected ? `${applied} migrations appliquées, comme attendu par cette version.` : `${applied} migrations appliquées pour ${expected} attendues : lancer « npm run db:migrate » avant de servir cette version.`
  );

  const chain = verifyChain(await repositories.ledger.listAll());
  add("ledger", "Journal chaîné", chain.ok ? "OK" : "FAIL", chain.ok ? `${chain.count} événements, chaîne intègre (tête n° ${chain.headSeq}).` : `Chaîne rompue au n° ${chain.brokenAtSeq} : ${chain.reason}. Ne rien corriger à la main ; voir EXPLOITATION.md, « Incidents ».`);

  // Rules move forward from their watermark; a building whose readings run ahead of it is not being evaluated.
  const devices = await repositories.devices.list();
  const lags: string[] = [];
  let evaluated = 0;
  for (const building of await repositories.buildings.list()) {
    const own = devices.filter((d) => d.buildingId === building.id);
    if (!own.some((d) => d.type === "PASSERELLE")) continue;
    const sensors = await repositories.telemetrySensors.listByDevices(own.map((d) => d.id));
    const last = (await repositories.readings.rangeOf(sensors.map((s) => s.id))).last;
    if (!last) continue;
    evaluated++;
    const mark = await repositories.ruleWatermarks.get(building.id);
    const lag = Date.parse(last) - (mark ? Date.parse(mark) : 0);
    if (lag > RULES_LAG_TOLERANCE_MS) lags.push(`${building.code} : ${mark ? fmtAge(lag) : "jamais évalué"}`);
  }
  add(
    "rules",
    "Moteur de règles",
    lags.length ? "WARN" : "OK",
    evaluated === 0 ? "Aucun bâtiment ne transmet." : lags.length ? `Règles en retard sur les mesures — ${lags.join(" ; ")}. La tâche planifiée tourne-t-elle (cron /api/cron/telemetry ou npm run telemetry:jobs) ?` : `${evaluated} bâtiment(s) évalué(s) jusqu'à leur dernière mesure.`
  );

  const oldest = await repositories.readings.oldestCapturedAt();
  // A demonstration database is frozen at its scenario date: its ages are measured from its newest
  // reading, or the purge would look stopped once the scenario is three months old.
  const frozen = env.DATABASE_SNAPSHOT || env.DEMO_MODE;
  const newest = frozen ? (await repositories.readings.rangeOf((await repositories.telemetrySensors.listAll()).map((s) => s.id))).last : null;
  const reference = newest ? Date.parse(newest) : now.getTime();
  const age = oldest ? reference - Date.parse(oldest) : 0;
  const from = newest ? " avant la dernière mesure (base de démonstration figée)" : "";
  add(
    "retention",
    "Rétention des mesures brutes",
    oldest && age > (RAW_RETENTION_DAYS + 1) * DAY ? "WARN" : "OK",
    !oldest
      ? "Aucune mesure brute."
      : age > (RAW_RETENTION_DAYS + 1) * DAY
        ? `Mesure brute la plus ancienne : ${fmtAge(age)}${from}, au-delà des ${RAW_RETENTION_DAYS} jours : la purge planifiée ne tourne pas.`
        : `Mesure brute la plus ancienne : ${fmtAge(age)}${from} (purge à ${RAW_RETENTION_DAYS} jours).`
  );

  const silent = (await repositories.ruleStates.listByRule("CAPTEUR_SILENCIEUX")).filter((s) => s.state !== "NORMAL");
  add("silence", "Passerelles et capteurs muets", silent.length ? "WARN" : "OK", silent.length ? `${silent.length} sujet(s) en silence, dont ${silent.filter((s) => s.subjectKey.startsWith("gateway:")).length} passerelle(s) : voir Alertes.` : "Aucun silence en cours.");

  const since = new Date(now.getTime() - DAY).toISOString();
  const recent = await repositories.authEvents.list({}, 5_000);
  const failures = recent.filter((e) => e.at >= since && e.outcome === "ECHEC").length;
  const blocked = recent.filter((e) => e.at >= since && e.outcome === "BLOQUE").length;
  add("signin", "Connexions (24 h)", blocked ? "WARN" : "OK", `${failures} échec(s), ${blocked} blocage(s)${blocked ? " : regarder le journal des connexions (essais répétés ?)" : ""}.`);

  const open = (await repositories.alerts.list()).filter((a) => a.status === "OPEN");
  const stale = open.filter((a) => now.getTime() - Date.parse(a.raisedAt) > DAY);
  add("alerts", "Alertes non prises en compte", stale.length ? "WARN" : "OK", open.length ? `${open.length} ouverte(s), dont ${stale.length} depuis plus de 24 h.` : "Aucune.");

  if (env.NODE_ENV === "production" && !env.DATABASE_SNAPSHOT && !env.DEMO_MODE) {
    const missing = [!env.LEDGER_ANCHOR_KEY && "LEDGER_ANCHOR_KEY (ancres du journal)", !env.CRON_SECRET && "CRON_SECRET (tâches planifiées par route)"].filter(Boolean);
    add("secrets", "Secrets de production", missing.length ? "WARN" : "OK", missing.length ? `Non configuré(s) : ${missing.join(", ")}.` : "Clés d'ancrage et de planification configurées.");
  } else {
    add("secrets", "Secrets de production", "OK", "Démonstration ou développement : les clés de production ne sont pas exigées.");
  }
  return out;
}
