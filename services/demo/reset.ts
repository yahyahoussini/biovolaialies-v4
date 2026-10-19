import { truncateAllTables } from "../../data/db/truncate";
import { repositories } from "../../data/repositories";
import { seedDatabase } from "../../data/seed/seed-database";
import { clearTelemetrySeriesCache } from "../telemetry/evaluate";
import { AuthorizationError, ConflictError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

export interface DemoResetResult {
  heroLotId: string;
  anomalyCount: number;
  lotTokenValue: string;
  productTokenValue: string;
}

/**
 * Restores the hero scenario to its known initial state (phase-10 brief §5). This is
 * destructive by design — it empties every table and replays the deterministic seed — so it
 * is guarded three ways, all of which must hold:
 *
 *   1. DEMO_MODE must be on (off by default in production, see lib/env.ts).
 *   2. The caller must hold SETTINGS:EDIT, which today is SUPER_ADMIN only — checked through
 *      the same central matrix as everything else, never an ad-hoc role comparison.
 *   3. The caller may not wipe a database that isn't the demo dataset: the expected demo
 *      admin account must be present. That is what keeps this from being pointed at real
 *      production data if the flag is ever misconfigured.
 *
 * The audit entry is written *after* reseeding, since the reset necessarily clears the
 * previous audit log — it is the first entry of the fresh scenario, not a lost one.
 */
export async function resetDemoScenario(session: Session): Promise<DemoResetResult> {
  if (!env.DEMO_MODE) {
    throw new AuthorizationError("La réinitialisation de démonstration est désactivée sur cet environnement.");
  }
  if (!can(session, "EDIT", "SETTINGS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour réinitialiser la démonstration.");
  }

  const demoAdmin = await repositories.users.findByEmail("admin@biovolailles.demo");
  if (!demoAdmin) {
    throw new ConflictError(
      "Cette base ne correspond pas au jeu de démonstration attendu — réinitialisation refusée par sécurité."
    );
  }

  logger.warn("demo", `Demo reset requested by user ${session.userId} — wiping and reseeding.`);
  await truncateAllTables();
  clearTelemetrySeriesCache();
  const result = await seedDatabase({ lightTelemetry: true });

  await recordAudit({
    actorId: null, // the acting user's row was just deleted and recreated with a new id; attributing to a stale id would dangle
    entityType: "demo_scenario",
    entityId: result.heroLotId,
    field: null,
    oldValue: null,
    newValue: "RESET",
    reason: "Réinitialisation du scénario de démonstration",
    relatedLotId: result.heroLotId,
    relatedEventId: null,
  });

  logger.info("demo", "Demo reset complete.");
  return {
    heroLotId: result.heroLotId,
    anomalyCount: result.anomalyCount,
    lotTokenValue: result.lotTokenValue,
    productTokenValue: result.productTokenValue,
  };
}
