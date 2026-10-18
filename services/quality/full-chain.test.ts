import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import {
  createChickLot,
  createEggLot,
  createHatchCycle,
  placeChicksIntoLot,
  recordCandling,
  recordHatch,
} from "../hatchery/hatchery";
import { listLedgerEventsForObject, verifyLedger } from "../ledger/ledger";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { buildLotTraceabilityChain } from "../traceability/chain";
import { createShipment } from "../traceability/shipment";
import { buildFullChain, SIM } from "./chain-fixture";
import { activeHoldsOn, decideHold, getQualityCase, openHold } from "./holds";
import { buildRecallReport, recallReportToCsv } from "./recall";

describe("full chain: genetics → QR, hold propagation, recall", () => {
  it("links the hatchery chain into the farm lot's traceability graph", async () => {
    const c = await buildFullChain("g1");
    const chain = await buildLotTraceabilityChain(c.lot.id, c.admin);
    const types = new Set(chain.nodes.map((n) => n.type));
    for (const t of ["PARENT_FLOCK", "EGG_LOT", "HATCH_CYCLE", "CHICK_LOT", "LOT", "PRODUCT", "SHIPMENT", "DESTINATION"]) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  it("does not leak a sibling lot hatched from the same flock into a lot's chain", async () => {
    const c = await buildFullChain("sib");
    const eggs2 = await createEggLot({ code: "OAC-sib-2", parentFlockId: c.flock.id, collectedAt: "2026-06-10", quantity: 1000, ...SIM }, c.admin);
    const cycle2 = await createHatchCycle({ code: "INC-sib-2", buildingId: c.couvoir.id, incubatorRef: "Inc 5", setAt: "2026-06-12", allocations: [{ eggLotId: eggs2.id, quantity: 1000 }], ...SIM }, c.admin);
    await recordCandling({ cycleId: cycle2.id, candledAt: "2026-06-22", clearsRemoved: 100 }, c.admin);
    await recordHatch({ cycleId: cycle2.id, hatchedAt: "2026-07-03", chicksHatched: 850, unhatched: 50, culls: 0 }, c.admin);
    const chicks2 = await createChickLot({ code: "PSS-sib-2", hatchCycleId: cycle2.id, quantity: 800, grade: "A", dispatchedAt: "2026-07-03", ...SIM }, c.admin);
    const elevage = (await repositories.buildings.list()).find((b) => b.code === "ELV-sib")!;
    const sibling = await createLot({ code: "BU-sib-2", buildingId: elevage.id, species: "Poulet de chair", breed: "Ross 308", initialPopulation: 800, plannedStartAt: null, dataStatus: "SIMULATION" }, c.admin);
    await placeChicksIntoLot({ lotId: sibling.id, chickLotId: chicks2.id, quantity: 800 }, c.admin);

    const chain = await buildLotTraceabilityChain(sibling.id, c.admin);
    const codes = chain.nodes.map((n) => n.code);
    expect(codes).toContain("PF-sib");
    expect(codes).not.toContain("BU-sib");
    expect(codes).not.toContain("PRD-sib");
  });

  it("enforces hatchery balances (T31)", async () => {
    const c = await buildFullChain("g2");
    // 6000 eggs, 5000 already set → only 1000 left.
    await expect(
      createHatchCycle({ code: "INC-g2-b", buildingId: c.couvoir.id, incubatorRef: "Inc 4", setAt: "2026-06-04", allocations: [{ eggLotId: c.eggs.id, quantity: 1001 }], ...SIM }, c.admin)
    ).rejects.toThrow(/1000 œufs restent/);
    // 4250 hatched − 50 culls − 4200 dispatched = 0 left.
    await expect(createChickLot({ code: "PSS-g2-b", hatchCycleId: c.cycle.id, quantity: 1, grade: "B", dispatchedAt: "2026-06-25", ...SIM }, c.admin)).rejects.toThrow(/0 poussins/);
  });

  it("propagates a hold from an egg lot to every descendant and blocks derivations (T05)", async () => {
    const c = await buildFullChain("h1");
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "h1-tech");
    const qualityCase = await openHold({ rootType: "EGG_LOT", rootId: c.eggs.id, reason: "RESULTAT_LABORATOIRE", description: "Salmonelle suspectée sur le troupeau parental", scope: "DESCENDANTS", evidence: "LAB-2026-044" }, tech);

    expect(await activeHoldsOn("PRODUCT", c.product.id)).toHaveLength(1);
    expect(await activeHoldsOn("SHIPMENT", c.shipment.id)).toHaveLength(1);
    expect(await activeHoldsOn("PARENT_FLOCK", c.flock.id)).toHaveLength(0);

    await expect(
      createShipment({ code: "EXP-h1-b", productId: c.product.id, destinationId: c.destination.id, quantity: 10, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)
    ).rejects.toThrow(/blocage qualité/);

    const view = await getQualityCase(qualityCase.id, c.admin);
    expect(view.items.length).toBeGreaterThanOrEqual(8);
  });

  it("only lets a different, authorised person release, with evidence (R10, T06, T07)", async () => {
    const c = await buildFullChain("h2");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "h2-quality");
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "h2-tech");
    const qc = await openHold({ rootType: "PRODUCT", rootId: c.product.id, reason: "TEMPERATURE_HORS_LIMITE", description: "Rupture de froid en chambre 2", scope: "DESCENDANTS", evidence: "" }, quality);

    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Contrôle visuel conforme, enregistreur relu.", evidence: "ENR-7" }, tech)).rejects.toThrow(/responsable qualité/);
    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Contrôle visuel conforme, enregistreur relu.", evidence: "ENR-7" }, quality)).rejects.toThrow(/quatre yeux/);

    const otherQuality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "h2-quality-b");
    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "trop court", evidence: "ENR-7" }, otherQuality)).rejects.toThrow(/20 caractères/);
    const released = await decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Enregistreur relu : excursion de 12 min sous 4 °C, conforme.", evidence: "ENR-7; PV-QA-12" }, otherQuality);
    expect(released.status).toBe("LIBERE");
    expect(await activeHoldsOn("PRODUCT", c.product.id)).toHaveLength(0);
    const journal = await listLedgerEventsForObject(c.admin, "quality_case", qc.id);
    expect(journal.filter((e) => e.eventType === "QUALITY_DECISION_REFUSED")).toHaveLength(3);

    await createShipment({ code: "EXP-h2-b", productId: c.product.id, destinationId: c.destination.id, quantity: 100, unit: "kg", shippedAt: "2026-08-07", dataStatus: "SIMULATION" }, c.admin);
    expect((await verifyLedger(c.admin)).ok).toBe(true);
  });

  it("builds an upstream + downstream recall with quantities (T03, T04, T13)", async () => {
    const c = await buildFullChain("r1");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "r1-quality");

    const down = await buildRecallReport("EGG_LOT", c.eggs.id, quality);
    expect(down.products.map((p) => p.code)).toEqual(["PRD-r1"]);
    expect(down.products[0]).toMatchObject({ quantity: 2500, shipped: 1000, onHand: 1500 });
    expect(down.shipments[0]).toMatchObject({ destinationCity: "Casablanca", quantity: 1000 });
    expect(down.totals.destinationCount).toBe(1);
    expect(down.durationMs).toBeLessThan(60_000);

    const up = await buildRecallReport("PRODUCT", c.product.id, quality);
    expect(up.upstream.some((n) => n.type === "PARENT_FLOCK" && n.code === "PF-r1")).toBe(true);
    expect(recallReportToCsv(up, "QC-TEST")).toContain("PF-r1");
  });

  it("keeps out-of-scope users away from holds and recalls", async () => {
    const c = await buildFullChain("s1");
    const other = await createTestSession("FARM_MANAGER", "FARM", "another-farm", "s1-fm");
    await expect(openHold({ rootType: "LOT", rootId: c.lot.id, reason: "AUTRE", description: "Tentative hors périmètre", scope: "OBJET_SEUL", evidence: "" }, other)).rejects.toThrow(/périmètre/);
    await expect(buildRecallReport("LOT", c.lot.id, other)).rejects.toThrow(/périmètre/);
  });
});
