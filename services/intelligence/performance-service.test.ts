import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { getLotPerformanceOverview, getPerformanceSnapshot, isTrendable } from "./performance-service";

async function seedLot(suffix: string) {
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "COOPERATIVE" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "R" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Producer ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Farm ${suffix}`, city: "City", region: "R", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `BAT-${suffix}`, name: "Building", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await repositories.lots.create({
    buildingId: building.id,
    code: `LOT-${suffix}`,
    species: "Poulet",
    breed: "Ross",
    status: "ACTIF",
    initialPopulation: 1000,
    currentPopulation: 1000,
    plannedStartAt: null,
    startedAt: "2026-07-01T06:00:00.000Z",
    endedAt: null,
    dataStatus: "SIMULATION",
  });
  return { lot, building, farm };
}

const PROVENANCE = { sourceType: "SIMULATEUR" as const, sourceId: null, actorId: null, measurementMethod: null, deviceId: null, documentId: null, validationStatus: null };

describe("isTrendable", () => {
  it("is true for the four rolling-period KPIs and false for the instantaneous/bracketed ones", () => {
    expect(isTrendable("AVERAGE_WEIGHT")).toBe(true);
    expect(isTrendable("MORTALITY_RATE")).toBe(true);
    expect(isTrendable("FEED_CONSUMPTION")).toBe(true);
    expect(isTrendable("WATER_CONSUMPTION")).toBe(true);
    expect(isTrendable("CURRENT_POPULATION")).toBe(false);
    expect(isTrendable("FCR")).toBe(false);
  });
});

describe("getPerformanceSnapshot", () => {
  it("throws for a non-trendable KPI code", async () => {
    const { lot } = await seedLot("PERF1");
    await expect(getPerformanceSnapshot(lot.id, "CURRENT_POPULATION")).rejects.toThrow();
  });

  it("reports INCREASING when the current period's feed clearly exceeds the previous one", async () => {
    const { lot } = await seedLot("PERF2");
    const now = new Date("2026-08-16T00:00:00.000Z");
    await repositories.feedUsage.create({ lotId: lot.id, occurredAt: "2026-08-04T00:00:00.000Z", quantity: 100, unit: "KG", feedType: "x", feedSource: null, ...PROVENANCE, dataStatus: "SIMULATION" });
    await repositories.feedUsage.create({ lotId: lot.id, occurredAt: "2026-08-12T00:00:00.000Z", quantity: 300, unit: "KG", feedType: "x", feedSource: null, ...PROVENANCE, dataStatus: "SIMULATION" });

    const snapshot = await getPerformanceSnapshot(lot.id, "FEED_CONSUMPTION", now, 7);
    expect(snapshot.current.value).toBe(300);
    expect(snapshot.previous.value).toBe(100);
    expect(snapshot.trend.direction).toBe("INCREASING");
    expect(snapshot.trend.deviationPercent).toBe(200);
  });

  it("reports INSUFFICIENT_DATA when a period has no records at all", async () => {
    const { lot } = await seedLot("PERF3");
    const snapshot = await getPerformanceSnapshot(lot.id, "AVERAGE_WEIGHT", new Date("2026-08-16T00:00:00.000Z"), 7);
    expect(snapshot.trend.direction).toBe("INSUFFICIENT_DATA");
  });

  it("reads a lot that has ended at its end: its last week stays, compared with the week before", async () => {
    const { lot } = await seedLot("PERF5");
    await repositories.feedUsage.create({ lotId: lot.id, occurredAt: "2026-08-04T00:00:00.000Z", quantity: 100, unit: "KG", feedType: "x", feedSource: null, ...PROVENANCE, dataStatus: "SIMULATION" });
    await repositories.feedUsage.create({ lotId: lot.id, occurredAt: "2026-08-12T00:00:00.000Z", quantity: 300, unit: "KG", feedType: "x", feedSource: null, ...PROVENANCE, dataStatus: "SIMULATION" });
    await repositories.lots.updateStatus(lot.id, "CLOTURE", { endedAt: "2026-08-16T00:00:00.000Z" });

    // Read two months later, as a finished lot's archive is.
    const later = new Date("2026-10-29T00:00:00.000Z");
    const snapshot = await getPerformanceSnapshot(lot.id, "FEED_CONSUMPTION", later, 7);
    expect(snapshot.current.value).toBe(300);
    expect(snapshot.previous.value).toBe(100);
    expect(snapshot.trend.direction).toBe("INCREASING");
    expect(snapshot.current.period).toMatchObject({ to: new Date("2026-08-16T00:00:00.000Z"), label: "7 derniers jours avant la clôture" });
    expect(snapshot.current.calculatedAt).toBe(later.toISOString());

    const population = (await getLotPerformanceOverview(lot.id, later)).find((o) => o.code === "CURRENT_POPULATION")!;
    expect(population.result.period.label).toBe("À la clôture");
  });
});

describe("getLotPerformanceOverview", () => {
  it("returns exactly the six registered KPIs, each with a trend where applicable", async () => {
    const { lot } = await seedLot("PERF4");
    const overview = await getLotPerformanceOverview(lot.id, new Date("2026-08-16T00:00:00.000Z"));
    expect(overview.map((o) => o.code).sort()).toEqual(
      ["AVERAGE_WEIGHT", "CURRENT_POPULATION", "FCR", "FEED_CONSUMPTION", "MORTALITY_RATE", "WATER_CONSUMPTION"].sort()
    );
    const population = overview.find((o) => o.code === "CURRENT_POPULATION")!;
    expect(population.trend).toBeUndefined();
    const weight = overview.find((o) => o.code === "AVERAGE_WEIGHT")!;
    expect(weight.trend).toBeDefined();
  });
});
