import { describe, expect, it } from "vitest";
import { dbClient } from "../../data/db/client";
import { repositories } from "../../data/repositories";
import { createTestSession } from "../production/test-support";
import { operationsStatus } from "./status";

describe("operations status", () => {
  it("reports what has quietly stopped, measured on the database", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "ops-admin");
    const farmer = await createTestSession("PRODUCER", "PRODUCER", null, "ops-farmer");
    await expect(operationsStatus(farmer)).rejects.toThrow();

    const healthy = Object.fromEntries((await operationsStatus(admin)).map((s) => [s.key, s.status]));
    expect(healthy).toMatchObject({ database: "OK", schema: "OK", ledger: "OK", rules: "OK", retention: "OK", silence: "OK" });

    // A migration recorded as missing: the schema signal blocks, with the command to run.
    // (drizzle's SQLite migrations table leaves its id column empty: the row is found by its rowid.)
    await dbClient.execute("DELETE FROM __drizzle_migrations WHERE rowid = (SELECT rowid FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1)");
    const behind = (await operationsStatus(admin)).find((s) => s.key === "schema")!;
    expect(behind).toMatchObject({ status: "FAIL", detail: expect.stringContaining("npm run db:migrate") });

    // A gateway whose readings run hours ahead of the rules: the scheduled jobs are not running.
    const org = await repositories.organizations.create({ name: "Ops", type: "INTERNAL" });
    const coop = await repositories.cooperatives.create({ organizationId: org.id, name: "Coop ops", region: "Fès-Meknès" });
    const producer = await repositories.producers.create({ cooperativeId: coop.id, name: "P ops", contactPhone: null, contactEmail: null });
    const farm = await repositories.farms.create({ producerId: producer.id, name: "Ferme ops", city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
    const building = await repositories.buildings.create({ farmId: farm.id, code: "OPS-1", name: "Bâtiment", capacity: 100, zoneType: "ELEVAGE" });
    const gateway = await repositories.devices.create({ buildingId: building.id, code: "GW-OPS", type: "PASSERELLE", status: "ONLINE", installedAt: "2026-01-01T00:00:00.000Z", lastCommunicationAt: null, batteryLevel: null, signalQuality: null });
    const probe = await repositories.devices.create({ buildingId: building.id, code: "OPS-A01", type: "CAPTEUR", status: "ONLINE", installedAt: "2026-01-01T00:00:00.000Z", lastCommunicationAt: null, batteryLevel: null, signalQuality: null });
    await repositories.devices.attach(probe.id, { catalogRef: "A01", gatewayId: gateway.id });
    const sensor = await repositories.sensors.create({ deviceId: probe.id, sensorType: "TEMPERATURE", unit: "C", status: "ONLINE", configuration: null, code: "OPS-A01-T", catalogRef: "A01", zoneId: null, position: null, mountingHeightM: null });
    await repositories.readings.insertIgnoringDuplicates([
      { sensorId: sensor.id, deviceId: probe.id, buildingId: building.id, lotId: null, value: 24, unit: "C", capturedAt: new Date().toISOString(), sourceType: "CAPTEUR", sourceId: "GW-OPS", actorId: null, dataStatus: "TEST", measurementMethod: "A01", documentId: null, validationStatus: null, zoneId: null, qualityFlag: "OK", attribution: null, ingestMessageId: null, receivedAt: new Date().toISOString() },
    ]);
    const rules = (await operationsStatus(admin)).find((s) => s.key === "rules")!;
    expect(rules).toMatchObject({ status: "WARN", detail: expect.stringContaining("OPS-1 : jamais évalué") });
  });
});
