import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import type { Sensor } from "../../domain/iot/types";
import { createTestSession } from "../production/test-support";
import { calibrationRegister, recordCalibration } from "./calibration";
import { provisionBuildingUnchecked } from "./provisioning";

async function fixture(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `cal-${suffix}`);
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "R" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `P ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `F ${suffix}`, city: "Meknès", region: "R", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `C${suffix}`, name: "B", capacity: 4000, zoneType: "ELEVAGE" });
  await provisionBuildingUnchecked(building.id, { installedAt: "2026-01-01T00:00:00Z" });
  const devices = await repositories.devices.listByBuilding(building.id);
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  return { admin, sensors };
}

const base = {
  method: "Comparaison in situ",
  referenceInstrument: "Sonde étalon, certificat 2026-01",
  tolerance: 0.3,
  intervalDays: 180,
  evidenceRef: "PV-ETAL-1",
};

describe("calibration register (document 3, lot 6)", () => {
  it("computes the result against the tolerance, never takes it as declared", async () => {
    const { admin, sensors } = await fixture("r1");
    const t = sensors.find((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE")!;
    const ok = await recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-01T09:00:00Z", referenceValue: 25, measuredValue: 25.2 }, admin);
    expect(ok.result).toBe("CONFORME");
    expect(ok.nextDueAt).toBe("2026-08-28T09:00:00.000Z");
    const adjusted = await recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-02T09:00:00Z", referenceValue: 25, measuredValue: 25.8, offsetApplied: -0.7 }, admin);
    expect(adjusted.result).toBe("AJUSTE");
  });

  it("puts a non-conforming sensor out of service, and back in service once it conforms", async () => {
    const { admin, sensors } = await fixture("r2");
    const t = sensors.find((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE")!;
    const bad = await recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-01T09:00:00Z", referenceValue: 25, measuredValue: 27 }, admin);
    expect(bad.result).toBe("NON_CONFORME");
    expect((await repositories.sensors.findById(t.id))?.status).toBe("FAULT");
    await recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-05T09:00:00Z", referenceValue: 25, measuredValue: 25.1 }, admin);
    expect((await repositories.sensors.findById(t.id))?.status).toBe("ONLINE");
  });

  it("reports due dates, never-calibrated channels and drift over successive checks", async () => {
    const { admin, sensors } = await fixture("r3");
    const nh3 = sensors.find((s) => s.catalogRef === "A03")!;
    for (const [at, measured] of [["2025-09-01T09:00:00Z", 25.3], ["2025-12-01T09:00:00Z", 25.9], ["2026-03-01T09:00:00Z", 26.6]] as const) {
      await recordCalibration({ ...base, tolerance: 2, intervalDays: 90, sensorId: nh3.id, calibratedAt: at, referenceValue: 25, measuredValue: measured }, admin);
    }
    const register = await calibrationRegister(admin, new Date("2026-05-20T00:00:00Z"));
    const row = register.find((r) => r.sensorId === nh3.id)!;
    expect(row.errors).toEqual([0.3, 0.9, 1.6]);
    expect(row.drifting).toBe(true);
    expect(row.status).toBe("A_ECHEANCE");
    expect(register.find((r) => r.ref === "A04")?.status).toBe("JAMAIS");
    expect((await calibrationRegister(admin, new Date("2026-06-10T00:00:00Z"))).find((r) => r.sensorId === nh3.id)?.status).toBe("ECHU");
  });

  it("refuses a calibration without evidence or reference instrument", async () => {
    const { admin, sensors } = await fixture("r4");
    const t = sensors[0];
    await expect(recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-01T09:00:00Z", referenceValue: 1, measuredValue: 1, evidenceRef: "" }, admin)).rejects.toThrow();
    await expect(recordCalibration({ ...base, sensorId: t.id, calibratedAt: "2026-03-01T09:00:00Z", referenceValue: 1, measuredValue: 1, referenceInstrument: "x" }, admin)).rejects.toThrow();
  });
});
