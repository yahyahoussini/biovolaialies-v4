import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../data/db/client";
import { measurements } from "../../data/db/schema";
import { repositories } from "../../data/repositories";
import type { Sensor } from "../../domain/iot/types";
import type { GatewayMessage } from "../../domain/telemetry/ingest";
import { authenticateApiKey, createApiClient } from "../api/clients";
import { createTestSession } from "../production/test-support";
import { seedStartingBands } from "./bands";
import { runSilenceCheck } from "./evaluate";
import { ingestGatewayBatch, verifyIngestMessage } from "./ingest";
import { startOccupation } from "./occupation";
import { provisionBuildingUnchecked } from "./provisioning";
import { simulateGateway, type Scenario } from "./simulator";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LOT_START = Date.parse("2026-06-20T06:00:00Z");

async function fixture(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `tel-${suffix}`);
  await createTestSession("TECHNICIAN", "GLOBAL", null, `tel-tech-${suffix}`);
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `P ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `T${suffix}`, name: "Bâtiment test", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await repositories.lots.create({
    buildingId: building.id,
    code: `BELDI-${suffix}`,
    species: "Poulet",
    breed: "Beldi",
    status: "ACTIF",
    initialPopulation: 4000,
    currentPopulation: 4000,
    plannedStartAt: null,
    startedAt: new Date(LOT_START).toISOString(),
    endedAt: null,
    dataStatus: "SIMULATION",
    productionLine: "CHAIR_FERMIER",
  });
  const provisioned = await provisionBuildingUnchecked(building.id, { installedAt: new Date(LOT_START - DAY).toISOString() });
  for (const zone of provisioned.zones.filter((z) => z.kind === "ELEVAGE")) {
    await startOccupation({ zoneId: zone.id, lotId: lot.id, startedAt: new Date(LOT_START).toISOString(), headCount: 1333 }, admin);
  }
  await seedStartingBands(admin.userId);
  const { key } = await createApiClient({ name: `Passerelle ${suffix}`, scopes: ["telemetry:write"], gatewayCode: provisioned.gatewayCode }, admin);
  const principal = (await authenticateApiKey(`Bearer ${key}`))!;

  const devices = await repositories.devices.listByBuilding(building.id);
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  const zones = new Map((await repositories.zones.listByFarm(farm.id)).map((z) => [z.id, z.code]));
  const channels = sensors.map((s) => ({ code: s.code!, ref: s.catalogRef!, type: s.sensorType, position: s.position ?? null, zoneCode: s.zoneId ? zones.get(s.zoneId) ?? null : null }));
  const simDevices = devices.filter((d) => d.catalogRef).map((d) => ({ code: d.code, ref: d.catalogRef! }));
  const simulate = (from: number, to: number, scenarios: Scenario[] = [], startSeq = 1) =>
    simulateGateway({ gateway: provisioned.gatewayCode, channels, devices: simDevices, from, to, lotStartedAt: LOT_START, population: 4000, scenarios, startSeq });
  return { admin, building, lot, provisioned, principal, simulate, sensors };
}

/** What a gateway does when it resends its buffer: same messages, same seq, sent now. */
const resentAt = (messages: GatewayMessage[], now: number) => messages.map((m) => ({ ...m, sentAt: new Date(now).toISOString() }));

describe("gateway ingestion", () => {
  it("provisions document 2's reference building", async () => {
    const { provisioned, sensors } = await fixture("p1");
    expect(provisioned.gatewayCode).toBe("GW-TP1");
    const refs = new Set(sensors.map((s) => s.catalogRef));
    for (const ref of ["A01", "A02", "A03", "A04", "A05", "A06", "B01", "B02", "C01", "C02", "C03", "C04", "C05", "D01", "D04", "E01", "E02"]) expect(refs).toContain(ref);
    expect(sensors.filter((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE").map((s) => s.position)).toEqual(["8,5 m", "25 m", "41,5 m"]);
  });

  it("stores, flags, deduplicates, and anchors each message in the ledger", async () => {
    const f = await fixture("i1");
    const t0 = LOT_START + 40 * DAY;
    const batch = f.simulate(t0, t0 + 30 * 60_000);
    const first = await ingestGatewayBatch(resentAt(batch, t0 + 31 * 60_000), f.principal, new Date(t0 + 31 * 60_000));
    expect(first.every((r) => r.status === "accepted")).toBe(true);
    const accepted = first.reduce((n, r) => n + r.readings.accepted, 0);
    expect(accepted).toBeGreaterThan(500);
    expect(first.filter((r) => Object.keys(r.readings.flagged).length > 0).map((r) => r.readings.flagged)).toEqual([]);

    // The same buffer resent after a lost acknowledgement: nothing is written twice.
    const again = await ingestGatewayBatch(resentAt(batch, t0 + 40 * 60_000), f.principal, new Date(t0 + 40 * 60_000));
    expect(again.every((r) => r.status === "duplicate")).toBe(true);

    // A counter that restarted reuses a seq for new content: accepted, and reported.
    const a01 = f.sensors.find((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE")!;
    const reused = await ingestGatewayBatch(
      [
        { gateway: f.provisioned.gatewayCode, seq: 1, sentAt: new Date(t0 + 41 * 60_000).toISOString(), readings: [{ sensor: a01.code!, at: new Date(t0 + 40 * 60_000).toISOString(), value: 24 }] },
        { gateway: f.provisioned.gatewayCode, seq: 9001, sentAt: new Date(t0 + 41 * 60_000).toISOString(), readings: [{ sensor: "NOPE-1", at: new Date(t0 + 40 * 60_000).toISOString(), value: 1 }, { sensor: a01.code!, at: new Date(t0 + 3 * HOUR).toISOString(), value: 24 }] },
      ],
      f.principal,
      new Date(t0 + 41 * 60_000)
    );
    expect(reused[0].seqReused).toBe(true);
    expect(reused[0].readings.accepted).toBe(1);
    expect(reused[1].readings.rejected).toBe(1);
    expect(reused[1].readings.flagged.HORLOGE).toBe(1);

    // A key bound to this gateway cannot speak for another one.
    const other = await fixture("i1b");
    const wrong = await ingestGatewayBatch(resentAt(other.simulate(t0, t0 + 2 * 60_000), t0 + 3 * 60_000), f.principal, new Date(t0 + 3 * 60_000));
    expect(wrong[0].status).toBe("rejected");

    // Readings are tied to the lot through the occupation table, and labelled as simulation.
    const row = await db.query.measurements.findFirst({ where: eq(measurements.sensorId, a01.id) });
    expect(row?.lotId).toBe(f.lot.id);
    expect(row?.attribution).toBe("OCCUPATION");
    expect(row?.dataStatus).toBe("SIMULATION");

    // The ledger holds a hash of what was stored: an edit afterwards shows.
    const message = (await repositories.ingestMessages.listRecent(50)).find((m) => m.gatewayId && m.seq === 2 && m.readingCount > 0)!;
    expect((await verifyIngestMessage(message.id)).status).toBe("INTACT");
    await db.update(measurements).set({ value: 99 }).where(eq(measurements.ingestMessageId, message.id));
    expect((await verifyIngestMessage(message.id)).status).toBe("MODIFIE");
  });

  it("replays a backlog after an outage: the alerts carry the instant they would have fired", async () => {
    const f = await fixture("c1");
    const t0 = LOT_START + 40 * DAY;
    const scenarios: Scenario[] = [
      { kind: "NH3_EPISODE", zoneSuffix: "38 m", from: t0 + 30 * HOUR, to: t0 + 33.5 * HOUR, ppm: 30 },
      { kind: "SCREW_STALL", line: "Ligne 2", from: t0 + 33 * HOUR, to: t0 + 34 * HOUR },
      { kind: "WATER_DROP_PUMP", from: t0 + 56 * HOUR, to: t0 + 63 * HOUR, factor: 0.45 },
      { kind: "NIGHT_DOOR", at: Date.parse("2026-08-01T01:30:00Z") + 0 * DAY, badge: null },
    ];
    const all = f.simulate(t0, t0 + 64 * HOUR, scenarios);
    const split = all.findIndex((m) => Date.parse(m.sentAt) > t0 + 24 * HOUR);
    // First day arrives live, in four batches.
    for (let i = 0; i < 4; i++) {
      const part = all.slice(Math.floor((split / 4) * i), Math.floor((split / 4) * (i + 1)));
      const sentAt = Date.parse(part[part.length - 1].sentAt) + 5000;
      await ingestGatewayBatch(resentAt(part, sentAt), f.principal, new Date(sentAt));
    }
    // Then the gateway goes quiet: the silence check, running on the clock, says so once.
    await runSilenceCheck(new Date(t0 + 30 * HOUR));
    const gatewayId = (await repositories.devices.findByCode(f.provisioned.gatewayCode))!.id;
    const silenceStates = (await repositories.ruleStates.listByRule("CAPTEUR_SILENCIEUX")).filter((s) => s.buildingId === f.building.id && s.state !== "NORMAL");
    // One verdict for the whole gateway, not one per channel.
    expect(silenceStates.map((s) => s.subjectKey)).toEqual([`gateway:${gatewayId}`]);
    expect(silenceStates[0].state).toBe("CRITIQUE");
    expect(silenceStates[0].openAlertId).toBeTruthy();

    // Back online at t0+64h: 40 hours of buffer arrive at once.
    const now = t0 + 64 * HOUR + 60_000;
    const results = await ingestGatewayBatch(resentAt(all.slice(split), now), f.principal, new Date(now));
    expect(results.every((r) => r.status === "accepted")).toBe(true);
    expect(results.every((r) => Object.keys(r.readings.flagged).length === 0)).toBe(true);
    await runSilenceCheck(new Date(now));
    expect((await repositories.ruleStates.listByRule("CAPTEUR_SILENCIEUX")).find((s) => s.subjectKey === `gateway:${gatewayId}`)?.state).toBe("NORMAL");

    const transitions = await repositories.ruleTransitions.listByBuilding(f.building.id, new Date(t0).toISOString(), new Date(now).toISOString());
    const first = (rule: string, to: string) => transitions.find((t) => t.ruleCode === rule && t.toState === to);
    const nh3 = first("NH3_EXPOSITION", "CRITIQUE");
    expect(nh3).toBeDefined();
    expect(Date.parse(nh3!.at)).toBeGreaterThan(t0 + 30 * HOUR);
    expect(Date.parse(nh3!.at)).toBeLessThan(t0 + 33.5 * HOUR);
    const screw = first("VIS_SANS_ROTATION", "CRITIQUE");
    expect(screw).toBeDefined();
    const water = first("EAU_PROFIL", "ALERTE");
    expect(water?.diagnosis).toContain("pompe");
    expect(Date.parse(water!.at)).toBeGreaterThan(t0 + 56 * HOUR);
    expect(first("ACCES_HORS_PLAGE", "ALERTE")?.diagnosis).toContain("hors de la plage");
    // Only changes of state are written: far fewer rows than evaluation steps.
    expect(transitions.length).toBeLessThan(60);

    // Each alert went to level 1, and the notification says plainly that no provider is configured.
    expect(nh3!.alertId).toBeTruthy();
    const alert = await repositories.alerts.findById(nh3!.alertId!);
    expect(alert?.escalationLevel).toBe(1);
    const notifications = await repositories.alertNotifications.listByAlert(alert!.id);
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.every((n) => n.status === "NON_CONFIGURE")).toBe(true);

    // 15-minute and hourly buckets, with availability against the 1-minute acquisition of A01.
    const a01 = f.sensors.find((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE")!;
    const quarters = await repositories.aggregates.list("15m", [a01.id], new Date(t0 + 2 * HOUR).toISOString(), new Date(t0 + 3 * HOUR).toISOString());
    expect(quarters).toHaveLength(4);
    expect(quarters.every((q) => q.count === 15 && q.expected === 15)).toBe(true);
    const hours = await repositories.aggregates.list("1h", [a01.id], new Date(t0).toISOString(), new Date(now).toISOString());
    expect(hours.length).toBe(64);
    expect(hours[5].count).toBe(60);
  }, 120_000);
});
