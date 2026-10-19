import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runRetention } from "@/services/telemetry/aggregate";
import { runEscalation } from "@/services/telemetry/alerting";
import { evaluateAllBuildings, runSilenceCheck } from "@/services/telemetry/evaluate";

function authorized(request: Request): boolean {
  const given = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!env.CRON_SECRET || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.CRON_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled telemetry work, every few minutes: rules that a backlog left behind, the silence
 * check (a quiet gateway sends nothing that would trigger it otherwise), escalation of
 * unacknowledged alerts, and the retention tiers. Closed unless CRON_SECRET is configured.
 */
export async function GET(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) return Response.json({ error: "CRON_SECRET non configuré : route fermée." }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const started = Date.now();
  try {
    const evaluations = await evaluateAllBuildings(15_000);
    const silence = await runSilenceCheck();
    const escalation = await runEscalation();
    const retention = await runRetention();
    return Response.json({ ok: true, durationMs: Date.now() - started, evaluations, silence, escalation, retention }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("general", "Telemetry jobs failed", error);
    return Response.json({ ok: false, error: "Échec des tâches de télémétrie." }, { status: 500 });
  }
}
