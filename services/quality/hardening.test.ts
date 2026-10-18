import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../data/db/client";
import { auditLog } from "../../data/db/schema";
import { repositories } from "../../data/repositories";
import { createApiClient } from "../api/clients";
import { apiRoute, json } from "../api/http";
import { apiAppendEvent } from "../api/operations";
import { withIdempotency } from "../api/idempotency";
import { createChickLot, createEggLot, createHatchCycle, placeChicksIntoLot, recordCandling, recordHatch } from "../hatchery/hatchery";
import { verifyAuditMirror } from "../ledger/ledger";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { createCollection } from "../traceability/collection";
import { createProduct } from "../traceability/product";
import { createShipment } from "../traceability/shipment";
import { createTransformationBatch } from "../traceability/transformation";
import { buildFullChain, SIM } from "./chain-fixture";
import { decideHold, openHold } from "./holds";

describe("review findings — concurrency", () => {
  it("never lets simultaneous cycles draw more eggs than a lot holds", async () => {
    const c = await buildFullChain("cc1");
    const eggs = await createEggLot({ code: "OAC-cc1-x", parentFlockId: c.flock.id, collectedAt: "2026-06-01", quantity: 1000, ...SIM }, c.admin);
    const attempts = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        createHatchCycle({ code: `INC-cc1-${i}`, buildingId: c.couvoir.id, incubatorRef: "Inc", setAt: "2026-06-02", allocations: [{ eggLotId: eggs.id, quantity: 1000 }], ...SIM }, c.admin)
      )
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("never ships more than the stock under simultaneous requests", async () => {
    const c = await buildFullChain("cc2");
    // 2500 kg packaged, 1000 already shipped by the fixture → 1500 left.
    const attempts = await Promise.allSettled(
      [1, 2].map((i) => createShipment({ code: `EXP-cc2-${i}`, productId: c.product.id, destinationId: c.destination.id, quantity: 1000, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin))
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("lets only one of two simultaneous decisions apply (compare-and-set)", async () => {
    const c = await buildFullChain("cc3");
    const q1 = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "cc3-q1");
    const q2 = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "cc3-q2");
    const qc = await openHold({ rootType: "PRODUCT", rootId: c.product.id, reason: "AUTRE", description: "Contrôle de cohérence", scope: "OBJET_SEUL", evidence: "" }, c.admin);
    const justification = "Décision documentée par le laboratoire interne.";
    const results = await Promise.allSettled([
      decideHold({ caseId: qc.id, decision: "LIBERE", justification, evidence: "LAB-1" }, q1),
      decideHold({ caseId: qc.id, decision: "NON_CONFORME", justification, evidence: "LAB-2" }, q2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await repositories.qualityCases.findById(qc.id);
    const items = await repositories.qualityCases.listItems(qc.id);
    // Whichever won, the case status and the items agree.
    expect(items.every((i) => i.active === (final!.status !== "LIBERE"))).toBe(true);
  });
});

describe("review findings — scope and balances", () => {
  it("refuses egg lots and chick lots from outside the caller's perimeter", async () => {
    const a = await buildFullChain("sc-a");
    const b = await buildFullChain("sc-b");
    const farmB = (await repositories.buildings.findById(b.couvoir.id))!.farmId;
    const managerB = await createTestSession("FARM_MANAGER", "FARM", farmB, "sc-fm-b");
    const foreignEggs = await createEggLot({ code: "OAC-sc-a-2", parentFlockId: a.flock.id, collectedAt: "2026-06-01", quantity: 500, ...SIM }, a.admin);
    await expect(
      createHatchCycle({ code: "INC-sc-b-x", buildingId: b.couvoir.id, incubatorRef: "Inc", setAt: "2026-06-02", allocations: [{ eggLotId: foreignEggs.id, quantity: 100 }], ...SIM }, managerB)
    ).rejects.toThrow(/périmètre/);

    const elevageB = (await repositories.buildings.list()).find((x) => x.code === "ELV-sc-b")!;
    const lotB = await createLot({ code: "BU-sc-b-2", buildingId: elevageB.id, species: "Poulet", breed: "Ross 308", initialPopulation: 100, plannedStartAt: null, dataStatus: "SIMULATION" }, managerB);
    await expect(placeChicksIntoLot({ lotId: lotB.id, chickLotId: a.chicks.id, quantity: 10 }, managerB)).rejects.toThrow(/périmètre/);
  });

  it("caps chicks placed into a lot at its initial population, across chick lots", async () => {
    const c = await buildFullChain("pl1");
    const eggs = await createEggLot({ code: "OAC-pl1-2", parentFlockId: c.flock.id, collectedAt: "2026-06-01", quantity: 100, ...SIM }, c.admin);
    const cycle = await createHatchCycle({ code: "INC-pl1-2", buildingId: c.couvoir.id, incubatorRef: "Inc", setAt: "2026-06-02", allocations: [{ eggLotId: eggs.id, quantity: 100 }], ...SIM }, c.admin);
    await recordCandling({ cycleId: cycle.id, candledAt: "2026-06-12", clearsRemoved: 0 }, c.admin);
    await recordHatch({ cycleId: cycle.id, hatchedAt: "2026-06-23", chicksHatched: 100, unhatched: 0, culls: 0 }, c.admin);
    const x = await createChickLot({ code: "PSS-pl1-x", hatchCycleId: cycle.id, quantity: 50, grade: "A", dispatchedAt: "2026-06-23", ...SIM }, c.admin);
    const y = await createChickLot({ code: "PSS-pl1-y", hatchCycleId: cycle.id, quantity: 50, grade: "A", dispatchedAt: "2026-06-23", ...SIM }, c.admin);
    const elevage = (await repositories.buildings.list()).find((b) => b.code === "ELV-pl1")!;
    const lot = await createLot({ code: "BU-pl1-small", buildingId: elevage.id, species: "Poulet", breed: "Ross 308", initialPopulation: 60, plannedStartAt: null, dataStatus: "SIMULATION" }, c.admin);
    await placeChicksIntoLot({ lotId: lot.id, chickLotId: x.id, quantity: 40 }, c.admin);
    await expect(placeChicksIntoLot({ lotId: lot.id, chickLotId: y.id, quantity: 21 }, c.admin)).rejects.toThrow(/déjà placés/);
    await placeChicksIntoLot({ lotId: lot.id, chickLotId: y.id, quantity: 20 }, c.admin);
  });

  it("refuses dates out of order and in the future", async () => {
    const c = await buildFullChain("dt1");
    await expect(createEggLot({ code: "OAC-dt1-f", parentFlockId: c.flock.id, collectedAt: "2999-01-01", quantity: 10, ...SIM }, c.admin)).rejects.toThrow(/futur/);
    await expect(createEggLot({ code: "OAC-dt1-b", parentFlockId: c.flock.id, collectedAt: "2025-01-01", quantity: 10, ...SIM }, c.admin)).rejects.toThrow(/précéder/);
    const eggs = await createEggLot({ code: "OAC-dt1-ok", parentFlockId: c.flock.id, collectedAt: "2026-06-10", quantity: 10, ...SIM }, c.admin);
    await expect(
      createHatchCycle({ code: "INC-dt1-late", buildingId: c.couvoir.id, incubatorRef: "Inc", setAt: "2026-06-09", allocations: [{ eggLotId: eggs.id, quantity: 10 }], ...SIM }, c.admin)
    ).rejects.toThrow(/précéder/);
  });
});

describe("review findings — derivations from held objects are refused everywhere (R09)", () => {
  it("blocks collection, transformation, product and shipment from a held source", async () => {
    const c = await buildFullChain("r09");
    await openHold({ rootType: "LOT", rootId: c.lot.id, reason: "SUSPICION_SANITAIRE", description: "Suspicion sur le lot entier", scope: "DESCENDANTS", evidence: "VET-1" }, c.admin);
    await expect(createCollection({ code: "COL-r09-2", lotId: c.lot.id, quantity: 10, unit: "KG", collectedAt: "2026-08-02", ...SIM, measurementMethod: "Pesée" }, c.admin)).rejects.toThrow(/blocage/);
    const slaughter = (await repositories.slaughterBatches.findByCode("AB-r09"))!;
    await expect(
      createTransformationBatch({ code: "TR-r09-2", upstreamType: "SLAUGHTER_BATCH", upstreamId: slaughter.id, processType: "Découpe", inputQuantity: 10, outputQuantity: 10, losses: 0, rejects: 0, occurredAt: "2026-08-03", ...SIM, measurementMethod: "Bon" }, c.admin)
    ).rejects.toThrow(/blocage/);
    const tr = (await repositories.transformationBatches.findByCode("TR-r09"))!;
    await expect(createProduct({ code: "PRD-r09-2", name: "X", category: "Frais", transformationBatchId: tr.id, packagingDate: "2026-08-04", ...SIM, measurementMethod: "E" }, c.admin)).rejects.toThrow(/blocage/);
    await expect(createShipment({ code: "EXP-r09-2", productId: c.product.id, destinationId: c.destination.id, quantity: 1, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)).rejects.toThrow(/blocage/);
  });

  it("blocks egg lots, cycles and chick lots from held upstream objects", async () => {
    const c = await buildFullChain("r09u");
    await openHold({ rootType: "PARENT_FLOCK", rootId: c.flock.id, reason: "SUSPICION_SANITAIRE", description: "Troupeau sous surveillance", scope: "DESCENDANTS", evidence: "" }, c.admin);
    await expect(createEggLot({ code: "OAC-r09u-2", parentFlockId: c.flock.id, collectedAt: "2026-06-05", quantity: 10, ...SIM }, c.admin)).rejects.toThrow(/blocage/);
    await expect(
      createHatchCycle({ code: "INC-r09u-2", buildingId: c.couvoir.id, incubatorRef: "Inc", setAt: "2026-06-05", allocations: [{ eggLotId: c.eggs.id, quantity: 10 }], ...SIM }, c.admin)
    ).rejects.toThrow(/blocage/);
  });
});

describe("review findings — duplicates and stock (R01, R04)", () => {
  it("refuses duplicate hatchery and shipment codes, and over-stock shipments", async () => {
    const c = await buildFullChain("r01");
    await expect(createEggLot({ code: "OAC-r01", parentFlockId: c.flock.id, collectedAt: "2026-06-02", quantity: 1, ...SIM }, c.admin)).rejects.toThrow(/déjà utilisé/);
    await expect(createShipment({ code: "EXP-r01", productId: c.product.id, destinationId: c.destination.id, quantity: 1, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)).rejects.toThrow(/déjà utilisé/);
    await expect(createShipment({ code: "EXP-r01-big", productId: c.product.id, destinationId: c.destination.id, quantity: 1501, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)).rejects.toThrow(/restent en stock/);
    await expect(createShipment({ code: "EXP-r01-unit", productId: c.product.id, destinationId: c.destination.id, quantity: 1, unit: "pièces", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)).rejects.toThrow(/unité/);
  });
});

describe("review findings — ledger and API", () => {
  it("refuses a replay that reuses a key for a different event", async () => {
    const c = await buildFullChain("id1");
    const { client } = await createApiClient({ name: "term-id1", scopes: ["events:write"] }, c.admin);
    const p = { clientId: client.id, name: client.name, scopes: ["events:write" as const] };
    const base = { eventType: "PESEE", objectType: "LOT", objectId: c.lot.id, occurredAt: "2026-10-01T10:00:00Z", payload: { kg: 2 }, idempotencyKey: "id1-key-0001" };
    await apiAppendEvent(base, p);
    await expect(apiAppendEvent({ ...base, eventType: "AUTRE_EVENEMENT" }, p)).rejects.toThrow(/déjà été utilisée/);
    await expect(apiAppendEvent({ ...base, objectType: "PRODUCT", objectId: c.product.id }, p)).rejects.toThrow(/déjà été utilisée/);
  });

  it("replays a creating API call from its stored result, and rejects a changed body", async () => {
    const c = await buildFullChain("id2");
    const { client } = await createApiClient({ name: "erp-id2", scopes: ["lots:write"] }, c.admin);
    const p = { clientId: client.id, name: client.name, scopes: ["lots:write" as const] };
    let runs = 0;
    const first = await withIdempotency(p, "POST /lots", "key-id2-0001", { a: 1 }, async () => ({ n: ++runs }));
    const again = await withIdempotency(p, "POST /lots", "key-id2-0001", { a: 1 }, async () => ({ n: ++runs }));
    expect(first).toEqual({ result: { n: 1 }, replayed: false });
    expect(again).toEqual({ result: { n: 1 }, replayed: true });
    await expect(withIdempotency(p, "POST /lots", "key-id2-0001", { a: 2 }, async () => ({ n: ++runs }))).rejects.toThrow(/différente/);
  });

  it("stops a key working once its issuer is no longer an administrator", async () => {
    const c = await buildFullChain("id3");
    const { key } = await createApiClient({ name: "lecture-id3", scopes: ["lots:read"] }, c.admin);
    const route = apiRoute("lots:read", async ({ correlationId }) => json({ ok: true }, 200, correlationId));
    const call = () => route(new Request("http://t/api/v1/x", { headers: { authorization: `Bearer ${key}` } }));
    expect((await call()).status).toBe(200);
    await repositories.users.update(c.admin.userId, { role: "FARM_MANAGER", scopeType: "FARM", scopeId: "x" });
    expect((await call()).status).toBe(401);
  });

  it("detects an audit row edited after the fact", async () => {
    const c = await buildFullChain("am1");
    const auditor = await createTestSession("AUDITOR", "GLOBAL", null, "am1-aud");
    expect((await verifyAuditMirror(auditor)).ok).toBe(true);
    const [row] = await repositories.auditLog.listByEntity("product", c.product.id);
    await db.update(auditLog).set({ newValue: "FORGED" }).where(eq(auditLog.id, row.id));
    const check = await verifyAuditMirror(auditor);
    expect(check.altered).toContain(row.id);
  });
});
