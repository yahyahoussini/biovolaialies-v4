import { describe, expect, it } from "vitest";
import { db, dbClient } from "../../data/db/client";
import { auditLog, buildings, lots } from "../../data/db/schema";
import { repositories } from "../../data/repositories";
import { AuthorizationError } from "../../domain/shared/errors";
import { createFeedUsageRecord, createMortalityRecord } from "../production/data-records";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { runIntegrityChecks } from "./checks";

async function seedHierarchy(suffix: string) {
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "COOPERATIVE" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "R" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Producer ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Farm ${suffix}`, city: "City", region: "R", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `BAT-${suffix}`, name: "Building", capacity: 5000, zoneType: "ELEVAGE" });
  return { org, coop, producer, farm, building };
}

async function seedLot(suffix: string, admin: Awaited<ReturnType<typeof createTestSession>>) {
  const { building } = await seedHierarchy(suffix);
  const lot = await createLot(
    {
      code: `LOT-${suffix}`,
      buildingId: building.id,
      species: "Poulet de chair",
      breed: "Ross 308",
      initialPopulation: 5000,
      plannedStartAt: null,
      dataStatus: "SIMULATION",
    },
    admin
  );
  return { building, lot };
}

/** SQLite FK enforcement is ON for the app connection — a couple of checks (T01/T02/T13) exist
 * specifically to catch corruption that should be structurally impossible under normal service
 * paths. Exercising them honestly requires writing a dangling reference directly, the same way
 * a real data-migration bug or an out-of-band write could produce one. */
async function withForeignKeysOff<T>(fn: () => Promise<T>): Promise<T> {
  await dbClient.execute("PRAGMA foreign_keys = OFF;");
  try {
    return await fn();
  } finally {
    await dbClient.execute("PRAGMA foreign_keys = ON;");
  }
}

describe("runIntegrityChecks", () => {
  it("rejects a caller without INTEGRITY permission", async () => {
    const technician = await createTestSession("TECHNICIAN", "FARM", "some-farm", "IC1");
    await expect(runIntegrityChecks(technician)).rejects.toThrow(AuthorizationError);
  });

  it("produces zero issues for its own lots across a multi-lot sweep (no false positives on well-formed data)", async () => {
    // Other tests in this file (and createTestSession's own fixture users, which deliberately
    // use placeholder scope ids like "some-farm") share this file's database, so the report's
    // GLOBAL totals aren't asserted here — only that these two well-formed lots stay clean.
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC2");
    const { lot: lotA } = await seedLot("IC2A", admin);
    const { lot: lotB } = await seedLot("IC2B", admin);

    const report = await runIntegrityChecks(admin);
    expect(report.checksRun).toBeGreaterThan(0);
    const ownIssues = report.issues.filter((i) => i.entityId === lotA.id || i.entityId === lotB.id);
    expect(ownIssues).toHaveLength(0);
  });

  it("T09 — flags a structured record claiming REEL while sourced from the simulator", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC3");
    const { lot } = await seedLot("IC3", admin);

    await createFeedUsageRecord(
      lot.id,
      { occurredAt: "2026-08-01T00:00:00.000Z", quantity: 50, unit: "KG", feedType: "Démarrage", dataStatus: "REEL", sourceType: "SIMULATEUR" },
      admin
    );

    const report = await runIntegrityChecks(admin);
    const hit = report.issues.find((i) => i.code === "T09_REAL_SIMULATION_MISMATCH" && i.entityType === "feed_usage_record");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("CRITICAL");
  });

  it("T17 — flags a lot whose currentPopulation wasn't reconciled after a mortality record", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC4");
    const { lot } = await seedLot("IC4", admin);

    // Bypasses createMortalityRecord's transaction (which keeps currentPopulation in sync) —
    // simulates a record written outside the normal service path.
    await repositories.mortalityRecords.create({
      lotId: lot.id,
      occurredAt: "2026-08-01T00:00:00.000Z",
      count: 200,
      suspectedCause: null,
      causeValidated: false,
      sourceType: "MANUEL",
      sourceId: null,
      actorId: admin.userId,
      dataStatus: "REEL",
      measurementMethod: "Comptage",
      deviceId: null,
      documentId: null,
      validationStatus: null,
    });

    const report = await runIntegrityChecks(admin);
    const hit = report.issues.find((i) => i.code === "T17_POPULATION_RECONCILIATION" && i.entityId === lot.id);
    expect(hit).toBeDefined();
  });

  it("createMortalityRecord (the real service path) keeps population reconciled — no T17 issue", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC5");
    const { lot } = await seedLot("IC5", admin);
    await createMortalityRecord(lot.id, { occurredAt: "2026-08-01T00:00:00.000Z", count: 100, dataStatus: "REEL", sourceType: "MANUEL" }, admin);

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T17_POPULATION_RECONCILIATION" && i.entityId === lot.id)).toBe(false);
  });

  it("T19 — flags an OPEN anomaly with no matching alert", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC6");
    const { lot } = await seedLot("IC6", admin);
    const rule = await repositories.rules.create({
      name: "Test rule IC6",
      target: "population",
      condition: { operator: "GT", threshold: 0 },
      severity: "WARNING",
      active: true,
      description: "Test",
      explanationTemplate: "Test",
    });
    const anomaly = await repositories.anomalies.create({
      ruleId: rule.id,
      measurementId: null,
      kpiValueId: null,
      lotId: lot.id,
      buildingId: null,
      severity: "WARNING",
      observedValue: null,
      referenceValue: null,
      deviationPercent: null,
      unit: null,
      confidence: "HIGH",
      explanation: { what: "", where: "", when: "", whatChanged: "", comparedTo: "", byHowMuch: "", basedOnData: "", whyTriggered: "" },
      detectedAt: "2026-08-01T00:00:00.000Z",
      status: "OPEN",
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T19_ANOMALY_WITHOUT_ALERT" && i.entityId === anomaly.id)).toBe(true);
  });

  it("T21 — flags an OFFLINE device", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC7");
    const { building } = await seedHierarchy("IC7");
    const device = await repositories.devices.create({
      buildingId: building.id,
      code: "DEV-IC7",
      type: "CAPTEUR_MULTI",
      status: "OFFLINE",
      installedAt: "2026-01-01T00:00:00.000Z",
      lastCommunicationAt: null,
      batteryLevel: 50,
      signalQuality: 80,
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T21_DEVICE_STALE_OFFLINE" && i.entityId === device.id)).toBe(true);
  });

  it("T21 — judges a frozen demonstration database against its newest reading, not against today", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC7F");
    const { building } = await seedHierarchy("IC7F");
    // Two online devices: one read at the database's newest instant, one gone quiet three hours before.
    const readAt = async (code: string, capturedAt: string) => {
      const device = await repositories.devices.create({ buildingId: building.id, code, type: "CAPTEUR_MULTI", status: "ONLINE", installedAt: "2026-01-01T00:00:00.000Z", lastCommunicationAt: capturedAt, batteryLevel: 50, signalQuality: 80 });
      const sensor = await repositories.sensors.create({ deviceId: device.id, sensorType: "TEMPERATURE", unit: "C", status: "ONLINE", configuration: null });
      await repositories.measurements.create({ sensorId: sensor.id, deviceId: device.id, buildingId: building.id, lotId: null, value: 24, unit: "C", capturedAt, sourceType: "SIMULATEUR", sourceId: null, actorId: null, dataStatus: "SIMULATION", measurementMethod: null, documentId: null, validationStatus: null });
      return device.id;
    };
    const live = await readAt("DEV-IC7F-LIVE", "2026-10-01T12:00:00.000Z");
    const quiet = await readAt("DEV-IC7F-QUIET", "2026-10-01T09:00:00.000Z");
    const flagged = async (frozen: boolean) => (await runIntegrityChecks(admin, frozen)).issues.filter((i) => i.code === "T21_DEVICE_STALE_OFFLINE").map((i) => i.entityId);

    // Against today, both readings are weeks old.
    expect(await flagged(false)).toEqual(expect.arrayContaining([live, quiet]));
    // Frozen at its newest reading, only the device that went quiet is.
    const frozen = await flagged(true);
    expect(frozen).toContain(quiet);
    expect(frozen).not.toContain(live);
  });

  it("T24 — flags two lots sharing the same business code", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC8");
    const { building: buildingA } = await seedHierarchy("IC8A");
    const { building: buildingB } = await seedHierarchy("IC8B");
    // Direct repository call — bypasses createLot's own uniqueness check (a service-level
    // guarantee, not a DB constraint) to simulate the exact corruption T24 exists to catch.
    await repositories.lots.create({
      buildingId: buildingA.id,
      code: "LOT-DUP-IC8",
      species: "Poulet",
      breed: "Ross",
      status: "ACTIF",
      initialPopulation: 1000,
      currentPopulation: 1000,
      plannedStartAt: null,
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: null,
      dataStatus: "SIMULATION",
    });
    await repositories.lots.create({
      buildingId: buildingB.id,
      code: "LOT-DUP-IC8",
      species: "Poulet",
      breed: "Ross",
      status: "ACTIF",
      initialPopulation: 1000,
      currentPopulation: 1000,
      plannedStartAt: null,
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: null,
      dataStatus: "SIMULATION",
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.filter((i) => i.code === "T24_DUPLICATE_CODE" && i.description.includes("LOT-DUP-IC8"))).toHaveLength(2);
  });

  it("T25 — flags a user whose scope target doesn't exist", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC9");
    const badUser = await repositories.users.create({
      email: "bad.scope.ic9@test.local",
      passwordHash: "x",
      fullName: "Bad Scope",
      role: "FARM_MANAGER",
      scopeType: "FARM",
      scopeId: "no-such-farm-ic9",
      active: true,
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T25_USER_SCOPE_INVALID" && i.entityId === badUser.id)).toBe(true);
  });

  it("T26 — flags a SUPER_ADMIN whose scopeType isn't GLOBAL", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC10");
    const { farm } = await seedHierarchy("IC10");
    const weirdAdmin = await repositories.users.create({
      email: "weird.admin.ic10@test.local",
      passwordHash: "x",
      fullName: "Weird Admin",
      role: "SUPER_ADMIN",
      scopeType: "FARM",
      scopeId: farm.id,
      active: true,
    });

    const report = await runIntegrityChecks(admin);
    const hit = report.issues.find((i) => i.code === "T26_USER_ROLE_SCOPE_STRUCTURE" && i.entityId === weirdAdmin.id);
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("CRITICAL");
  });

  it("T01 / T02 — flags a lot with a dangling buildingId and a building with a dangling farmId", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC11");
    const { orphanLot } = await withForeignKeysOff(async () => {
      await db
        .insert(buildings)
        .values({ farmId: "no-such-farm-ic11", code: "BAT-ORPHAN-IC11", name: "Orphan", capacity: 1000, zoneType: "ELEVAGE" });
      const [lotRow] = await db
        .insert(lots)
        .values({
          buildingId: "no-such-building-ic11",
          code: "LOT-ORPHAN-IC11",
          species: "Poulet",
          breed: "Ross",
          status: "ACTIF",
          initialPopulation: 100,
          currentPopulation: 100,
          dataStatus: "SIMULATION",
        })
        .returning();
      return { orphanLot: lotRow };
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T01_ORPHAN_LOT" && i.entityId === orphanLot.id)).toBe(true);
    expect(report.issues.some((i) => i.code === "T02_ORPHAN_BUILDING" && i.description.includes("BAT-ORPHAN-IC11"))).toBe(true);
  });

  it("T13 — flags an audit entry whose actor no longer resolves to a real user", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "IC12");
    await withForeignKeysOff(async () => {
      await db.insert(auditLog).values({
        actorId: "no-such-user-ic12",
        entityType: "lot",
        entityId: "some-lot-ic12",
        field: "status",
        oldValue: "CREE",
        newValue: "ACTIF",
        reason: null,
        relatedLotId: null,
        relatedEventId: null,
      });
    });

    const report = await runIntegrityChecks(admin);
    expect(report.issues.some((i) => i.code === "T13_INVALID_ACTOR" && i.entityId === "no-such-user-ic12")).toBe(true);
  });
});
