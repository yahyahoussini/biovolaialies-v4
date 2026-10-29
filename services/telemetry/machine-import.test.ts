import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../data/db/client";
import { measurements } from "../../data/db/schema";
import { repositories } from "../../data/repositories";
import type { Sensor } from "../../domain/iot/types";
import { guessProfile } from "../../domain/telemetry/machine-log";
import { buildSampleLog, toWindows1252 } from "../../domain/telemetry/machine-sample";
import { AppError } from "../../domain/shared/errors";
import { authenticateApiKey, createApiClient } from "../api/clients";
import { runIntegrityChecks } from "../integrity/checks";
import { createTestSession } from "../production/test-support";
import { runSilenceCheck } from "./evaluate";
import { ingestGatewayBatch } from "./ingest";
import { getMachineImport, importMachineLog, incubatorTargets, machineLogSample, setMachineFeed, verifyMachineImport } from "./machine-import";
import { provisionBuildingUnchecked } from "./provisioning";
import { simulateGateway } from "./simulator";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-09-22T06:00:00.000Z");

/** A hatchery with one incubator: independent probes read by the gateway, the machine read from its log. */
async function hatchery(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `mi-admin-${suffix}`);
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Couvoir ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Site couvoir ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `CV${suffix}`, name: "Couvoir", capacity: 0, zoneType: "COUVOIR" });
  const provisioned = await provisionBuildingUnchecked(building.id, { incubators: ["INC-1"], installedAt: new Date(T0 - 30 * 24 * HOUR).toISOString() });
  const zone = provisioned.zones.find((z) => z.kind === "INCUBATEUR")!;
  const manager = await createTestSession("HATCHERY_MANAGER", "FARM", farm.id, `mi-manager-${suffix}`);
  const { key } = await createApiClient({ name: `Passerelle ${suffix}`, scopes: ["telemetry:write"], gatewayCode: provisioned.gatewayCode }, admin);
  const principal = (await authenticateApiKey(`Bearer ${key}`))!;
  const devices = await repositories.devices.listByBuilding(building.id);
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  const zoneCodes = new Map((await repositories.zones.listByFarm(farm.id)).map((z) => [z.id, z.code]));
  /** The probes only: once the machine is read from its log, the gateway no longer speaks for it. */
  const probes = async (from: number, to: number) => {
    const channels = sensors.filter((s) => s.catalogRef === "H06").map((s) => ({ code: s.code!, ref: s.catalogRef!, type: s.sensorType, position: s.position ?? null, zoneCode: s.zoneId ? (zoneCodes.get(s.zoneId) ?? null) : null }));
    const messages = simulateGateway({ gateway: provisioned.gatewayCode, channels, devices: [], from, to, lotStartedAt: null, population: 0, scenarios: [], startSeq: 1 });
    // Sent as one catch-up, stamped when sent: the gateway's clock is right.
    await ingestGatewayBatch(messages.map((m) => ({ ...m, sentAt: new Date(to + MIN).toISOString() })), principal, new Date(to + MIN));
  };
  return { admin, farm, building, zone, manager, sensors, probes };
}

const fileOf = (text: string, name = "INC-1.csv") => ({ bytes: toWindows1252(text), name });

async function refused(task: Promise<unknown>, kind: string): Promise<string> {
  try {
    await task;
  } catch (error) {
    if (error instanceof AppError && error.kind === kind) return error.message;
    throw error;
  }
  throw new Error(`Expected a ${kind} refusal.`);
}

describe("incubator log import", () => {
  it("fills the machine channel from the file, fingerprinted, and compares it hour by hour with the probes", async () => {
    const h = await hatchery("a");
    await setMachineFeed(h.zone.id, "FICHIER", h.manager);
    const [target] = await incubatorTargets(h.manager);
    expect(target).toMatchObject({ feed: "FICHIER", probes: 3 + 1, lastImport: null });
    await h.probes(T0, T0 + 3 * HOUR);

    // Three hours of the machine's display, drifting up after a quarter of an hour, two minutes written "ERR".
    const text = buildSampleLog({ machine: "INC-1", from: T0, to: T0 + 3 * HOUR, driftFrom: T0 + 15 * MIN, faultMinutes: [10, 11], marker: false });
    const { bytes, name } = fileOf(text);
    const { profile } = guessProfile(new TextDecoder("windows-1252").decode(bytes));
    const now = new Date(T0 + 4 * HOUR);
    const result = await importMachineLog({ zoneId: h.zone.id, fileName: name, dataStatus: "SIMULATION", profile }, bytes, h.manager, now);
    expect(result.record).toMatchObject({ lines: 180, accepted: 178, duplicates: 0, rejected: 2, encoding: "Windows-1252", fromAt: new Date(T0).toISOString() });
    // Two lines above the header, then the header: minute i of the log is line 4 + i.
    expect(result.record.errors.map((e) => e.line)).toEqual([4 + 10, 4 + 11]);
    expect(result.comparison?.hours).toHaveLength(3);
    expect(result.comparison?.hours[0].beyond).toBe(false);
    expect(result.comparison?.beyond).toBeGreaterThanOrEqual(1);
    expect(result.comparison?.firstBeyondAt).toBe(new Date(T0 + 2 * HOUR).toISOString());

    // Stored on the machine channel, with the importer as actor and the import as source.
    const machine = h.sensors.find((s) => s.catalogRef === "PLC")!;
    const stored = await db.select().from(measurements).where(and(eq(measurements.sensorId, machine.id), eq(measurements.sourceId, result.record.id)));
    expect(stored).toHaveLength(178);
    expect(stored.every((m) => m.actorId === h.manager.userId && m.dataStatus === "SIMULATION" && m.ingestMessageId === null)).toBe(true);
    const ledger = await repositories.ledger.listByObject("MACHINE_IMPORT", result.record.id);
    expect(ledger.map((e) => e.eventType)).toEqual(["MACHINE_LOG_IMPORT"]);
    expect(ledger[0].payload).toMatchObject({ fileSha256: result.record.sha256, readingsStored: 178 });

    // The same file twice is refused; nothing is rewritten.
    expect(await refused(importMachineLog({ zoneId: h.zone.id, fileName: "copie.csv", dataStatus: "SIMULATION", profile }, bytes, h.manager, now), "CONFLICT")).toMatch(/déjà été importé/);
    // An overlapping export adds only what was not stored yet.
    const next = fileOf(buildSampleLog({ machine: "INC-1", from: T0 + 2 * HOUR, to: T0 + 3.5 * HOUR, marker: false }), "INC-1-suite.csv");
    const overlap = await importMachineLog({ zoneId: h.zone.id, fileName: next.name, dataStatus: "SIMULATION", profile }, next.bytes, h.manager, now);
    expect(overlap.record).toMatchObject({ lines: 90, accepted: 30, duplicates: 60 });

    // The stored readings are intact until one is edited behind the platform's back.
    expect(await verifyMachineImport(result.record.id, h.manager)).toBe("INTACT");
    await db.update(measurements).set({ value: 36.1 }).where(eq(measurements.id, stored[5].id));
    expect(await verifyMachineImport(result.record.id, h.manager)).toBe("MODIFIE");

    // A channel nobody reads live is never reported silent, however old its last line.
    await runSilenceCheck(new Date(T0 + 30 * HOUR));
    const silence = await repositories.ruleStates.listByRule("CAPTEUR_SILENCIEUX");
    expect(silence.some((s) => s.subjectKey === `sensor:${machine.id}`)).toBe(false);
    // Nor reported offline by the integrity engine: it has no live link to lose.
    const integrity = await runIntegrityChecks(h.admin);
    expect(integrity.issues.some((i) => i.code === "T21_DEVICE_STALE_OFFLINE" && i.entityId === machine.deviceId)).toBe(false);
    expect((await getMachineImport(result.record.id, h.manager)).row.importedByName).toMatch(/mi-manager-a/);
  });

  it("flags lines dated ahead of the server, and refuses the example as real data", async () => {
    const h = await hatchery("b");
    const now = new Date(T0 + HOUR);
    const ahead = fileOf(buildSampleLog({ machine: "INC-1", from: T0, to: T0 + 2 * HOUR, marker: false }));
    const { profile } = guessProfile(new TextDecoder("windows-1252").decode(ahead.bytes));
    const result = await importMachineLog({ zoneId: h.zone.id, fileName: ahead.name, dataStatus: "TEST", profile }, ahead.bytes, h.manager, now);
    // Lines more than the clock tolerance (5 min) after "now" are stored, flagged as an unreliable clock:
    // minutes 66 to 119 of the file.
    expect(result.flagged).toEqual({ HORLOGE: 54 });

    const sample = await machineLogSample(h.zone.id, h.manager);
    expect(sample.fileName).toBe(`exemple-journal-${h.zone.code}.csv`);
    expect(await refused(importMachineLog({ zoneId: h.zone.id, fileName: sample.fileName, dataStatus: "REEL", profile }, sample.body, h.manager, now), "VALIDATION")).toMatch(/exemple/);
  });

  it("keeps each hatchery to its own people", async () => {
    const h = await hatchery("c");
    const other = await hatchery("d");
    const text = fileOf(buildSampleLog({ machine: "INC-1", from: T0, to: T0 + HOUR, marker: false }));
    const { profile } = guessProfile(new TextDecoder("windows-1252").decode(text.bytes));
    const input = { zoneId: h.zone.id, fileName: text.name, dataStatus: "SIMULATION" as const, profile };
    await refused(importMachineLog(input, text.bytes, other.manager), "AUTHORIZATION");
    const farmer = await createTestSession("PRODUCER", "PRODUCER", null, "mi-farmer");
    await refused(importMachineLog(input, text.bytes, farmer), "AUTHORIZATION");
    await refused(setMachineFeed(h.zone.id, "FICHIER", other.manager), "AUTHORIZATION");
    expect((await incubatorTargets(other.manager)).map((t) => t.zone.id)).toEqual([other.zone.id]);
    // A column naming a channel the incubator does not have is refused before anything is read.
    expect(await refused(importMachineLog({ ...input, profile: { ...profile, channels: { HUMIDITE: "HR (%)" } } }, text.bytes, h.manager), "VALIDATION")).toMatch(/Aucune voie/);
  });
});
