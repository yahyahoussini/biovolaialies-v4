import { beforeAll, describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { DEMO_ACCOUNT_EMAIL } from "../../data/seed/generators/hierarchy";
import { HERO_LOT_CODE, seedDatabase } from "../../data/seed/seed-database";
import { AuthorizationError, ConflictError } from "../../domain/shared/errors";
import type { Session } from "../auth/session";
import { createTestSession } from "../production/test-support";
import { resetDemoScenario } from "./reset";

async function adminSession(): Promise<Session> {
  const user = await repositories.users.findByEmail(DEMO_ACCOUNT_EMAIL.SUPER_ADMIN);
  if (!user) throw new Error("demo admin missing");
  return { userId: user.id, role: "SUPER_ADMIN", scopeType: "GLOBAL", scopeId: null, isDemoSwitch: false };
}

describe("resetDemoScenario — guards", () => {
  it("refuses a database that isn't the demo dataset, even for a SUPER_ADMIN", async () => {
    // No seed has run yet in this file: the expected demo admin account is absent, which is
    // exactly the signal that stops this from being pointed at a real database.
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "RS-GUARD");
    await expect(resetDemoScenario(admin)).rejects.toThrow(ConflictError);
  });
});

describe("resetDemoScenario — on the seeded scenario", () => {
  beforeAll(async () => {
    await seedDatabase();
  }, 120_000);

  it("refuses every role that lacks SETTINGS:EDIT", async () => {
    for (const role of ["COOP_MANAGER", "PRODUCER", "FARM_MANAGER", "TECHNICIAN", "AUDITOR"] as const) {
      const session = await createTestSession(role, "GLOBAL", null, `RS-${role}`);
      await expect(resetDemoScenario(session)).rejects.toThrow(AuthorizationError);
    }
  });

  it("restores the hero scenario to its known initial state after arbitrary drift", async () => {
    const before = await repositories.lots.findByCode(HERO_LOT_CODE);
    expect(before).not.toBeNull();

    // Drift the scenario the way a demonstration would: change the lot, and add a stray lot.
    await repositories.lots.updateStatus(before!.id, "BLOQUE", {});
    await repositories.lots.update(before!.id, { species: "Dinde" });
    const building = await repositories.buildings.findById(before!.buildingId);
    await repositories.lots.create({
      buildingId: building!.id,
      code: "STRAY-LOT-RS",
      species: "Poulet",
      breed: "Ross",
      status: "ACTIF",
      initialPopulation: 10,
      currentPopulation: 10,
      plannedStartAt: null,
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: null,
      dataStatus: "SIMULATION",
    });

    const result = await resetDemoScenario(await adminSession());

    const after = await repositories.lots.findByCode(HERO_LOT_CODE);
    expect(after).not.toBeNull();
    expect(after!.id).toBe(result.heroLotId);
    // Restored to the seeded end-state, not left drifted.
    expect(after!.status).toBe("CLOTURE");
    expect(after!.species).toBe("Poulet de chair");
    // The stray record is gone — reset is a true restore, not a merge.
    expect(await repositories.lots.findByCode("STRAY-LOT-RS")).toBeNull();
    // And the id changed, proving rows were genuinely recreated rather than patched in place.
    expect(after!.id).not.toBe(before!.id);
  }, 120_000);

  it("produces a fully rebuilt scenario: users, chain, tokens and a fresh audit trail", async () => {
    const result = await resetDemoScenario(await adminSession());

    const users = await repositories.users.list();
    expect(users.length).toBeGreaterThanOrEqual(6);
    for (const email of Object.values(DEMO_ACCOUNT_EMAIL)) {
      expect(users.some((u) => u.email === email)).toBe(true);
    }

    const lot = await repositories.lots.findByCode(HERO_LOT_CODE);
    const tokens = await repositories.qrTokens.listByLot(lot!.id);
    expect(tokens.filter((t) => t.active).length).toBeGreaterThanOrEqual(2);
    expect(result.anomalyCount).toBeGreaterThan(0);

    // The reset itself is the first entry of the fresh audit log.
    const audit = await repositories.auditLog.search({ entityType: "demo_scenario" });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].newValue).toBe("RESET");
  }, 120_000);

  it("is deterministic — two consecutive resets yield the same scenario shape", async () => {
    const first = await resetDemoScenario(await adminSession());
    const snapshot = async () => {
      const [lots, farms, buildings, users, anomalies, runs] = await Promise.all([
        repositories.lots.list(),
        repositories.farms.list(),
        repositories.buildings.list(),
        repositories.users.list(),
        repositories.anomalies.list(),
        repositories.marking.listRuns(),
      ]);
      // The simulated marking line too: the same eggs unreadable, so the same stops and trays.
      const marking = await Promise.all(
        runs.map(async (r) => ({
          code: r.code,
          status: r.status,
          serials: [r.firstSerial, r.lastSerial],
          unreadable: (await repositories.marking.listExceptions(r.id, "ILLISIBLE", 10_000)).map((e) => e.serial).sort((x, y) => x - y),
          trays: (await repositories.marking.countTrays(r.id)).trays,
        }))
      );
      // And the simulated sensor values, not only how many there are.
      const readings: string[] = [];
      for (const device of await repositories.devices.list()) {
        for (const sensor of await repositories.sensors.listByDevice(device.id)) {
          const values = (await repositories.measurements.listBySensor(sensor.id)).filter((m) => m.sourceType === "SIMULATEUR");
          if (values.length) readings.push(`${device.code} ${sensor.sensorType} ×${values.length} Σ${values.reduce((sum, m) => sum + m.value, 0).toFixed(3)}`);
        }
      }
      return {
        lotCodes: lots.map((l) => l.code).sort(),
        farmNames: farms.map((f) => f.name).sort(),
        buildingCount: buildings.length,
        userEmails: users.map((u) => u.email).sort(),
        anomalyCount: anomalies.length,
        marking: marking.sort((x, y) => x.code.localeCompare(y.code)),
        readings: readings.sort(),
      };
    };
    const a = await snapshot();

    const second = await resetDemoScenario(await adminSession());
    const b = await snapshot();

    expect(b).toEqual(a);
    expect(second.anomalyCount).toBe(first.anomalyCount);
  }, 180_000);
});
