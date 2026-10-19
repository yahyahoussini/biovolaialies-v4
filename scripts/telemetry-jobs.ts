/**
 * The scheduled telemetry work, for a self-hosted server (cron every 5 minutes):
 *   rules left behind by a backlog, the silence check, escalation of unacknowledged alerts,
 *   and the retention tiers (raw 90 days, 15-minute buckets 2 years, hourly forever).
 * On Vercel the same work runs through GET /api/cron/telemetry with CRON_SECRET.
 */
import { runRetention } from "../services/telemetry/aggregate";
import { runEscalation } from "../services/telemetry/alerting";
import { evaluateAllBuildings, runSilenceCheck } from "../services/telemetry/evaluate";

async function main() {
  const started = Date.now();
  const evaluations = await evaluateAllBuildings(120_000);
  const silence = await runSilenceCheck();
  const escalation = await runEscalation();
  const retention = await runRetention();
  console.log(JSON.stringify({ durationMs: Date.now() - started, evaluations, silence, escalation, retention }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
