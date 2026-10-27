import { describe, expect, it } from "vitest";
import { addReading, availability, bucketStart, EMPTY_BUCKET, expectedCount, mean, mergeBuckets, overallAvailability, stddev } from "./aggregate";
import { ageDay, learnBand, percentile, seasonOf, selectBand, type LearningSample } from "./bands";
import { channelSpec, SENSOR_CATALOG, sensorSpec } from "./catalog";
import { dueLevels, nextEscalationAt } from "./escalation";
import { classifyReading, gatewayMessageSchema, type ReadingCheckInput } from "./ingest";
import { findOverlap, occupantAt } from "./occupation";
import type { ReferenceBand, ZoneOccupation } from "./types";

const occ = (over: Partial<ZoneOccupation>): ZoneOccupation => ({
  id: "o1",
  zoneId: "z1",
  lotId: "lot-a",
  startedAt: "2026-05-01T00:00:00Z",
  endedAt: "2026-08-01T00:00:00Z",
  headCount: 1000,
  note: null,
  recordedBy: null,
  ...over,
});

describe("catalogue (document 2)", () => {
  it("covers the 23 sensors of the decision table, each with a decision", () => {
    expect(SENSOR_CATALOG.map((s) => s.ref)).toEqual([
      "A01", "A02", "A03", "A04", "A05", "A06", "B01", "B02", "C01", "C02", "C03", "C04", "C05",
      "D01", "D04", "E01", "E02", "F02", "H06", "H03", "H06b", "L01", "L03", "O01",
    ]);
    for (const s of SENSOR_CATALOG) expect(s.decision.length).toBeGreaterThan(20);
  });

  it("keeps the client's frequencies", () => {
    expect(sensorSpec("A01")?.acquisitionSeconds).toBe(60);
    expect(sensorSpec("A01")?.reportSeconds).toBe(120);
    expect(sensorSpec("A05")?.acquisitionSeconds).toBe(30);
    expect(sensorSpec("B02")?.acquisitionSeconds).toBe(900);
    expect(sensorSpec("D01")?.acquisitionSeconds).toBe(300);
    expect(channelSpec("A01", "HUMIDITE")?.unit).toBe("%");
  });

  it("keeps the GSM alarm and the safety thermostat out of every software decision path", () => {
    expect(sensorSpec("L01")?.rules).toEqual([]);
    expect(sensorSpec("L03")?.rules).toEqual([]);
    expect(sensorSpec("F02")?.rules).toEqual([]);
  });
});

describe("occupation table", () => {
  const list = [occ({}), occ({ id: "o2", lotId: "lot-b", startedAt: "2026-08-01T00:00:00Z", endedAt: null })];

  it("ties a reading to the lot present at that instant, the leaving instant to the next lot", () => {
    expect(occupantAt(list, "z1", "2026-07-31T23:59:00Z")).toEqual({ lotId: "lot-a", attribution: "OCCUPATION" });
    expect(occupantAt(list, "z1", "2026-08-01T00:00:00Z")).toEqual({ lotId: "lot-b", attribution: "OCCUPATION" });
  });

  it("ties nothing when the zone is empty or unknown", () => {
    expect(occupantAt(list, "z1", "2026-04-01T00:00:00Z").attribution).toBe("AUCUN_LOT");
    expect(occupantAt(list, null, "2026-06-01T00:00:00Z").attribution).toBe("AUCUN_LOT");
  });

  it("refuses to guess between two lots in the same zone", () => {
    const both = [occ({}), occ({ id: "o3", lotId: "lot-c", startedAt: "2026-06-01T00:00:00Z", endedAt: "2026-06-10T00:00:00Z" })];
    expect(occupantAt(both, "z1", "2026-06-05T00:00:00Z")).toEqual({ lotId: null, attribution: "AMBIGU" });
  });

  it("detects overlapping occupations, open-ended ones included", () => {
    expect(findOverlap(list, { zoneId: "z1", lotId: "x", startedAt: "2026-07-15T00:00:00Z", endedAt: "2026-07-20T00:00:00Z" })?.id).toBe("o1");
    expect(findOverlap(list, { zoneId: "z1", lotId: "x", startedAt: "2026-09-01T00:00:00Z", endedAt: null })?.id).toBe("o2");
    expect(findOverlap(list, { zoneId: "z2", lotId: "x", startedAt: "2026-07-15T00:00:00Z", endedAt: null })).toBeNull();
    expect(findOverlap([occ({})], { zoneId: "z1", lotId: "x", startedAt: "2026-08-01T00:00:00Z", endedAt: null })).toBeNull();
  });
});

describe("reading checks", () => {
  const base: ReadingCheckInput = {
    channel: channelSpec("A01", "TEMPERATURE"),
    sensorType: "TEMPERATURE",
    sensorStatus: "ONLINE",
    value: 24,
    capturedAt: "2026-08-16T10:00:00Z",
    receivedAt: "2026-08-16T10:02:00Z",
    gatewayClockOffsetSeconds: 2,
    installedAt: "2026-01-01T00:00:00Z",
    calibrationDueAt: null,
    previous: { value: 23.8, capturedAt: "2026-08-16T09:59:00Z" },
  };

  it("passes a normal reading", () => expect(classifyReading(base)).toBe("OK"));
  it("distrusts a drifting gateway clock", () => expect(classifyReading({ ...base, gatewayClockOffsetSeconds: 900 })).toBe("HORLOGE"));
  it("distrusts a timestamp in the future", () => expect(classifyReading({ ...base, capturedAt: "2026-08-16T11:00:00Z" })).toBe("HORLOGE"));
  it("accepts a 3-day-old buffered reading", () => expect(classifyReading({ ...base, capturedAt: "2026-08-13T10:00:00Z", previous: null })).toBe("OK"));
  it("distrusts a reading older than the 30-day buffer", () => expect(classifyReading({ ...base, capturedAt: "2026-07-01T10:00:00Z" })).toBe("HORLOGE"));
  it("marks a faulty sensor", () => expect(classifyReading({ ...base, sensorStatus: "FAULT" })).toBe("CAPTEUR_HORS_SERVICE"));
  it("marks a physically impossible value", () => expect(classifyReading({ ...base, value: 85 })).toBe("HORS_PLAGE_PHYSIQUE"));
  it("marks an overdue calibration", () => expect(classifyReading({ ...base, calibrationDueAt: "2026-08-01T00:00:00Z" })).toBe("ETALONNAGE_ECHU"));
  it("marks a non-physical jump", () => expect(classifyReading({ ...base, value: 31 })).toBe("SUSPECT"));
  it("lets a silo delivery jump through", () =>
    expect(classifyReading({ ...base, channel: channelSpec("D01", "MASSE_SILO"), sensorType: "MASSE_SILO", value: 9000, previous: { value: 2000, capturedAt: "2026-08-16T09:55:00Z" } })).toBe("OK"));

  it("validates the gateway message and refuses timestamps without a time zone", () => {
    const ok = gatewayMessageSchema.safeParse({ gateway: "GW-1", seq: 1, sentAt: "2026-08-16T10:00:00Z", readings: [{ sensor: "S1", at: "2026-08-16T09:58:00Z", value: 1 }] });
    expect(ok.success).toBe(true);
    const bad = gatewayMessageSchema.safeParse({ gateway: "GW-1", seq: 1, sentAt: "2026-08-16T10:00:00", readings: [] });
    expect(bad.success).toBe(false);
  });
});

describe("aggregation tiers", () => {
  it("buckets to 15 minutes and to the hour", () => {
    expect(bucketStart("2026-08-16T10:44:59Z", "15m")).toBe("2026-08-16T10:30:00.000Z");
    expect(bucketStart("2026-08-16T10:44:59Z", "1h")).toBe("2026-08-16T10:00:00.000Z");
  });

  it("keeps flagged readings out of the statistics but counts them", () => {
    let b = EMPTY_BUCKET;
    for (const v of [20, 22, 24]) b = addReading(b, v, true);
    b = addReading(b, 99, false);
    expect(b.count).toBe(3);
    expect(b.suspectCount).toBe(1);
    expect(mean(b)).toBe(22);
    expect(b.max).toBe(24);
  });

  it("merges four quarters into exactly the hour computed from the raw values", () => {
    const values = [20, 21, 25, 19, 22, 30, 18, 23];
    let whole = EMPTY_BUCKET;
    for (const v of values) whole = addReading(whole, v, true);
    let merged = EMPTY_BUCKET;
    for (let q = 0; q < 4; q++) {
      let quarter = EMPTY_BUCKET;
      for (const v of values.slice(q * 2, q * 2 + 2)) quarter = addReading(quarter, v, true);
      merged = mergeBuckets(merged, quarter);
    }
    expect(mean(merged)).toBeCloseTo(mean(whole)!, 10);
    expect(stddev(merged)).toBeCloseTo(stddev(whole)!, 10);
    expect(merged.min).toBe(18);
    expect(merged.max).toBe(30);
  });

  it("computes availability from the acquisition interval, and none for event-driven channels", () => {
    expect(expectedCount("15m", 60)).toBe(15);
    expect(expectedCount("1h", 300)).toBe(12);
    expect(expectedCount("15m", null)).toBeNull();
    expect(availability({ count: 12 }, 15)).toBeCloseTo(0.8);
    expect(overallAvailability([{ count: 15, expected: 15 }, { count: 0, expected: 15 }, { count: 3, expected: null }])).toBeCloseTo(0.5);
  });
});

const band = (over: Partial<ReferenceBand>): ReferenceBand => ({
  id: "b",
  sensorType: "TEMPERATURE",
  productionLine: "*",
  ageDayFrom: 0,
  ageDayTo: 150,
  season: "TOUTES",
  low: 18,
  high: 30,
  unit: "C",
  source: "TECHNICIEN",
  status: "ACTIVE",
  version: 1,
  lotsUsed: null,
  samples: null,
  learnedFrom: null,
  supersedesId: null,
  note: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  decidedBy: null,
  decidedAt: null,
  ...over,
});

describe("reference bands", () => {
  it("knows Moroccan seasons and lot age", () => {
    expect(seasonOf("2026-01-15T00:00:00Z")).toBe("HIVER");
    expect(seasonOf("2026-07-15T00:00:00Z")).toBe("ETE");
    expect(ageDay("2026-08-01T06:00:00Z", "2026-08-11T05:00:00Z")).toBe(9);
  });

  it("prefers the lot's line and season, ignores inactive bands", () => {
    const bands = [
      band({ id: "generic" }),
      band({ id: "beldi", productionLine: "CHAIR_FERMIER" }),
      band({ id: "beldi-ete", productionLine: "CHAIR_FERMIER", season: "ETE" }),
      band({ id: "proposed", productionLine: "CHAIR_FERMIER", season: "ETE", status: "PROPOSEE" }),
      band({ id: "other-line", productionLine: "PONDEUSE_BLANC", season: "ETE" }),
    ];
    expect(selectBand(bands, "TEMPERATURE", "CHAIR_FERMIER", 40, "ETE")?.id).toBe("beldi-ete");
    expect(selectBand(bands, "TEMPERATURE", "CHAIR_FERMIER", 40, "HIVER")?.id).toBe("beldi");
    expect(selectBand(bands, "TEMPERATURE", null, 40, "ETE")?.id).toBe("generic");
    expect(selectBand(bands, "TEMPERATURE", "CHAIR_FERMIER", 200, "ETE")).toBeNull();
  });

  it("interpolates percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([0, 10], 25)).toBe(2.5);
  });

  it("refuses to learn from fewer than three finished lots", () => {
    const samples: LearningSample[] = Array.from({ length: 100 }, (_, i) => ({ lotId: i % 2 ? "a" : "b", age: 10, season: "ETE", value: 25, duringConfirmedProblem: false }));
    const out = learnBand(samples, { ageDayFrom: 0, ageDayTo: 20, season: "TOUTES" });
    expect(out.ok).toBe(false);
  });

  it("learns from every lot but leaves out the hours of a confirmed problem", () => {
    const samples: LearningSample[] = [];
    for (const lot of ["a", "b", "c"]) for (let h = 0; h < 30; h++) samples.push({ lotId: lot, age: 10, season: "ETE", value: 24 + (h % 5) * 0.5, duringConfirmedProblem: false });
    for (let h = 0; h < 10; h++) samples.push({ lotId: "c", age: 10, season: "ETE", value: 35, duringConfirmedProblem: true });
    const out = learnBand(samples, { ageDayFrom: 0, ageDayTo: 20, season: "ETE" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.band.lotsUsed).toBe(3);
    expect(out.band.excluded).toBe(10);
    expect(out.band.high).toBeLessThanOrEqual(26);
    expect(out.band.low).toBeGreaterThanOrEqual(24);
  });
});

describe("escalation", () => {
  it("climbs on schedule and stops at the top", () => {
    const raised = "2026-08-16T10:00:00Z";
    expect(nextEscalationAt("CRITICAL", raised, 1)).toBe("2026-08-16T10:15:00.000Z");
    expect(nextEscalationAt("CRITICAL", raised, 3)).toBeNull();
    expect(dueLevels("CRITICAL", raised, 1, Date.parse("2026-08-16T11:30:00Z")).map((s) => s.level)).toEqual([2, 3]);
    expect(dueLevels("WARNING", raised, 1, Date.parse("2026-08-16T10:30:00Z"))).toEqual([]);
  });
});
