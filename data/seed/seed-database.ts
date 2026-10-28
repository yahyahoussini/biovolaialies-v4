import type { Session } from "../../services/auth/session";
import { runBuildingDetection, runLotDetection } from "../../services/intelligence/detection";
import { repositories } from "../repositories";
import { hashPassword } from "../../lib/password";
import { logger } from "../../lib/logger";
import { createLotQrToken, createProductQrToken, demoPublicToken } from "../../services/traceability/qr-tokens";
import { buildDemoUserSpecs, DEMO_PASSWORD, seedHierarchy, type DemoUserSpec } from "./generators/hierarchy";
import { seedHeroPerformanceAnomaly } from "./generators/hero-performance-anomaly";
import { seedHeroTraceabilityChain } from "./generators/hero-traceability-chain";
import { seedIntelligenceDefinitions } from "./generators/intelligence-definitions";
import { seedIot } from "./generators/iot";
import { seedLots } from "./generators/lots";
import { seedEquipmentReference } from "../../services/equipment/equipment";
import { seedUpstreamChain } from "./generators/upstream-chain";
import { seedTelemetry } from "./generators/telemetry";
import { seedProductionFlow } from "./generators/production-flow";
import { seedEggMarking } from "./generators/egg-marking";
import { seedLaboratory } from "./generators/laboratory";
import { ensureDefaultLines } from "../../services/production/lines";
import { backfillBvuIds } from "../../services/identity/bvu-ids";
import { seedVerifiedTraceabilityChain, VERIFIED_LOT_CODE } from "./generators/verified-traceability-chain";

/** Fixed reference times for seed-time rule evaluation — deterministic and reproducible regardless of when the seed actually runs (same reasoning as phase-4's services/iot/hero-scenario.ts). */
const LOT_DETECTION_NOW = new Date("2026-08-16T00:00:00.000Z");
/** Well after the IoT seed's own history end (2026-08-16T12:00) so ONLINE devices genuinely read as stale. */
const BUILDING_DETECTION_NOW = new Date("2026-08-16T20:00:00.000Z");

export const HERO_LOT_CODE = "BU-2026-001";

export { VERIFIED_LOT_CODE };

export interface SeedResult {
  heroLotId: string;
  productId: string;
  anomalyCount: number;
  lotTokenValue: string;
  productTokenValue: string;
  /** Passport that reads "Traçabilité vérifiée" — the validated counterpart to the hero's cautious one. */
  verifiedProductTokenValue: string;
  userSpecs: DemoUserSpec[];
}

/**
 * Builds the entire deterministic demo dataset, in one place, using ONLY the normal
 * application services (createLot, runLotDetection, createCollection, createLotQrToken, …).
 * Nothing here writes a "demo-only" record that bypasses the real model — that constraint is
 * what makes the hero scenario a genuine end-to-end proof rather than a stage set.
 *
 * Shared by the CLI (`npm run db:seed`) and the protected in-app demo reset
 * (services/demo/reset.ts), so both produce byte-for-byte the same scenario.
 * Assumes an empty database; the caller decides how to get there.
 */
export interface SeedOptions {
  /**
   * Seed the hero lot WITHOUT its performance-decline records, leaving BU-2026-001 looking
   * normal. Used only by the presenter's "replay the anomaly" control
   * (services/demo/anomaly-scenario.ts) so the deviation → anomaly → alert chain can be shown
   * happening, instead of being already present when the demo opens. Default (false) is the
   * documented start state.
   */
  withoutHeroAnomaly?: boolean;
  /** 8 hours of telemetry instead of 56 — for the in-app reset, which must fit in one request. */
  lightTelemetry?: boolean;
}

export async function seedDatabase(options: SeedOptions = {}): Promise<SeedResult> {
  logger.info("seed", "Seeding the production lines of the client's flow…");
  await ensureDefaultLines();

  logger.info("seed", "Seeding hierarchy (1 organization, 3 cooperatives, 7 producers, 8 farms, 12 buildings)…");
  const hierarchy = await seedHierarchy();

  logger.info("seed", `Seeding lots (12 lots incl. hero lot ${HERO_LOT_CODE}) with event history…`);
  const { heroLotId } = await seedLots(hierarchy);

  logger.info("seed", "Seeding IoT devices, sensors and historical measurements…");
  await seedIot(hierarchy);

  const userSpecs = buildDemoUserSpecs(hierarchy);
  const passwordHash = hashPassword(DEMO_PASSWORD);
  let adminUserId = "";
  for (const spec of userSpecs) {
    const user = await repositories.users.create({
      email: spec.email,
      passwordHash,
      fullName: spec.fullName,
      role: spec.role,
      scopeType: spec.scopeType,
      scopeId: spec.scopeId,
      active: true,
    });
    if (spec.role === "SUPER_ADMIN") adminUserId = user.id;
  }

  logger.info("seed", `Seeding KPI/rule definitions and the hero performance-decline scenario (${HERO_LOT_CODE})…`);
  await seedIntelligenceDefinitions();
  if (!options.withoutHeroAnomaly) {
    await seedHeroPerformanceAnomaly(heroLotId);
  }

  logger.info("seed", "Running the anomaly rule engine over every lot and building…");
  const adminSession: Session = { userId: adminUserId, role: "SUPER_ADMIN", scopeType: "GLOBAL", scopeId: null, isDemoSwitch: false };
  const [allLots, allBuildings] = await Promise.all([repositories.lots.list(), repositories.buildings.list()]);
  let anomalyCount = 0;
  for (const lot of allLots) {
    const { created } = await runLotDetection(lot.id, adminSession, LOT_DETECTION_NOW);
    anomalyCount += created.length;
  }
  for (const building of allBuildings) {
    const { created } = await runBuildingDetection(building.id, adminSession, BUILDING_DETECTION_NOW);
    anomalyCount += created.length;
  }
  logger.info("seed", `Rule engine raised ${anomalyCount} anomaly(ies)/alert(s).`);

  logger.info("seed", `Seeding the downstream traceability chain for ${HERO_LOT_CODE} (collection → slaughter → transformation → product → destination)…`);
  const { productId } = await seedHeroTraceabilityChain(heroLotId, adminSession);

  // Built after detection has already run, exactly like the hero chain, so adding it cannot
  // change the documented anomaly/alert counts.
  logger.info("seed", `Seeding the validated traceability chain for ${VERIFIED_LOT_CODE} (reads "Traçabilité vérifiée")…`);
  const verified = await seedVerifiedTraceabilityChain(adminSession);

  logger.info("seed", "Seeding the upstream chain (parent flock → eggs → hatchery → chicks), shipments and a closed quality case…");
  await seedUpstreamChain({
    heroProducerId: hierarchy.heroProducerId,
    heroLotId,
    verifiedLotId: verified.lotId,
    heroProductId: productId,
    verifiedProductId: verified.productId,
    adminSession,
  });

  logger.info("seed", "Seeding telemetry (documents 2 and 3): reference beldi building, hatchery probes, 56 h of simulated gateway traffic with an outage and its catch-up…");
  await seedTelemetry({ heroProducerId: hierarchy.heroProducerId, adminSession, light: options.lightTelemetry });

  logger.info("seed", "Seeding the production flow of the handwritten diagram: parent-stock import, phases, two-sided transfers to partner farms, table eggs, reform…");
  await seedProductionFlow({ hierarchy, adminSession, heroProducerId: hierarchy.heroProducerId });

  logger.info("seed", "Seeding egg marking (document 3, lot 15): three lines, a week of marked and packed collections, a read-back stop, candling rejects named by their code…");
  await seedEggMarking({ adminSession });

  logger.info("seed", "Seeding the laboratory: salmonella controls, water, a confirmed mycoplasmosis read by the veterinarian, samples still at the laboratory…");
  await seedLaboratory();

  logger.info("seed", "Generating the hero public QR passports (lot + product)…");
  // Pinned so a demo reset restores the exact same public URLs (phase-12 brief §5/§7) —
  // a printed QR code stays valid across resets.
  const lotToken = await createLotQrToken(heroLotId, adminSession, null, demoPublicToken(`lot:${HERO_LOT_CODE}`));
  const productToken = await createProductQrToken(
    productId,
    heroLotId,
    adminSession,
    null,
    demoPublicToken(`product:${HERO_LOT_CODE}`)
  );

  // Pinned on the same scheme as the hero tokens, so this passport's printed QR also survives
  // a reset. Only a PRODUCT token is issued: BU-2025-010 is CLOTURE, and a lot passport reads
  // verified only at LIBERE — see the note in verified-traceability-chain.ts.
  const verifiedProductToken = await createProductQrToken(
    verified.productId,
    verified.lotId,
    adminSession,
    null,
    demoPublicToken(`product:${VERIFIED_LOT_CODE}`)
  );

  logger.info("seed", "Loading the client's equipment register (87 lines) and commissioning checklist (20 tests)…");
  await seedEquipmentReference();

  const assigned = await backfillBvuIds();
  logger.info("seed", `BIOVOLAILLES identifiers given to ${assigned} object(s) created without one.`);

  logger.info("seed", "Seed complete.");
  return {
    heroLotId,
    productId,
    anomalyCount,
    lotTokenValue: lotToken.token,
    productTokenValue: productToken.token,
    verifiedProductTokenValue: verifiedProductToken.token,
    userSpecs,
  };
}
