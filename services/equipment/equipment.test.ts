import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { AppError } from "../../domain/shared/errors";
import { produceExport } from "../exports/exports";
import { createTestSession } from "../production/test-support";
import { provisionBuildingUnchecked } from "../telemetry/provisioning";
import { buildingCommissioning, commissioningOverview, recordCommissioning } from "./commissioning";
import { getNomenclature, getNomenclatureArticle, seedNomenclature, updateNomenclatureArticle } from "./nomenclature";

async function refused(task: Promise<unknown>, kind: string): Promise<string> {
  try {
    await task;
  } catch (error) {
    if (error instanceof AppError && error.kind === kind) return error.message;
    throw error;
  }
  throw new Error(`Expected a ${kind} refusal.`);
}

const sheet = (overrides: Record<string, unknown> = {}) => ({
  ref: "A01",
  manufacturer: "Équivalent : caractéristiques minimales du champ 07",
  quantity: 6,
  quantityFormula: "2 par zone + 2 par bâtiment",
  location: "Hauteur des oiseaux, au tiers et aux deux tiers",
  function: "Déclenche la ventilation et le chauffage",
  specifications: "−40…+80 °C · ±0,3 °C · IP65 · 12–24 V",
  communication: "Modbus RTU sur RS-485",
  power: "24 V continu depuis l'armoire",
  connectors: "Presse-étoupe M16 · bornier à ressort",
  cables: "Paire torsadée blindée 2×0,5 + 2×0,75",
  priceLowMad: 111,
  priceHighMad: 323,
  priceConfidence: "haute",
  priceDate: "2026-10-20",
  installation: "Support déporté, 0,15 m de la paroi",
  spares: "1 par site + presse-étoupe + 5 m de câble",
  maintenance: "Contrôle annuel contre étalon · filtre à chaque vide",
  reason: "Consultation fournisseur n°1",
  ...overrides,
});

describe("purchasing nomenclature", () => {
  it("loads document 2 once, keeps completed sheets, and moves the budget with the quantities", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "nom-admin");
    await seedNomenclature();
    const before = await getNomenclature(admin);
    expect(before.articles).toHaveLength(106);
    expect(before.purchasable).toBe(0);
    // Fields 05 and 06 of a placed sensor start from its ch. 02 implantation sheet.
    expect((await getNomenclatureArticle("A02", admin)).article.location).toMatch(/12 m et 38 m/);

    const a01 = await updateNomenclatureArticle(sheet(), admin);
    expect(a01).toMatchObject({ manufacturer: expect.stringContaining("Équivalent"), priceDate: "2026-10-20", updatedBy: admin.userId });
    const after = await getNomenclature(admin);
    expect(after.purchasable).toBe(1);
    // Each changed field is in the article's history, with where the change came from.
    const history = (await getNomenclatureArticle("A01", admin)).history;
    expect(history.map((h) => h.field).sort()).toEqual(["03 Fabricant / type", "12 Date de la bande de prix"]);
    expect(history.every((h) => h.reason?.includes("Consultation fournisseur n°1"))).toBe(true);

    // Recalculated after the site survey: two more probes, and the budget follows.
    await updateNomenclatureArticle(sheet({ quantity: 8, reason: "Relevé du site" }), admin);
    const moved = (await getNomenclature(admin)).budget.find((b) => b.origin === "total")!;
    const was = before.budget.find((b) => b.origin === "total")!;
    expect(moved.lowMad - was.lowMad).toBe(2 * 111);
    expect(moved.highMad - was.highMad).toBe(2 * 323);

    // A reload never overwrites what was completed.
    await seedNomenclature();
    expect((await getNomenclature(admin)).articles).toHaveLength(106);
    expect((await getNomenclatureArticle("A01", admin)).article.quantity).toBe(8);

    // The purchasable list leaves the platform as a registered export.
    const { record, body } = await produceExport("nomenclature", admin, new Date("2026-10-29T10:00:00.000Z"));
    const csv = new TextDecoder().decode(body);
    expect(record.rows).toBe(106);
    expect(csv.split("\r\n")[0]).toContain("05 Emplacement");
    expect(csv).toContain("15/15");
  });

  it("is changed by a global role only, with a reason, and never to an inverted price band", async () => {
    await seedNomenclature();
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "nom-admin-2");
    const technician = await createTestSession("TECHNICIAN", "GLOBAL", null, "nom-tech");
    const farmAdmin = await createTestSession("SUPER_ADMIN", "FARM", "some-farm", "nom-farm-admin");
    await refused(updateNomenclatureArticle(sheet({ ref: "A02" }), technician), "AUTHORIZATION");
    await refused(updateNomenclatureArticle(sheet({ ref: "A02" }), farmAdmin), "AUTHORIZATION");
    expect(await refused(updateNomenclatureArticle(sheet({ ref: "A02", reason: "" }), admin), "VALIDATION")).toMatch(/modification/);
    expect(await refused(updateNomenclatureArticle(sheet({ ref: "A02", priceLowMad: 500, priceHighMad: 400 }), admin), "VALIDATION")).toMatch(/bande de prix/);
    await updateNomenclatureArticle(sheet({ ref: "A02" }), admin);
    expect(await refused(updateNomenclatureArticle(sheet({ ref: "A02" }), admin), "VALIDATION")).toMatch(/identique/);
  });
});

async function building(suffix: string, zoneType: "ELEVAGE" | "COUVOIR") {
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `P ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const b = await repositories.buildings.create({ farmId: farm.id, code: `RC${suffix}`, name: "Bâtiment", capacity: 4000, zoneType });
  await provisionBuildingUnchecked(b.id, { installedAt: "2025-02-15T08:00:00.000Z", incubators: ["INC-1"] });
  return { farm, building: b };
}

describe("commissioning per building", () => {
  it("applies the tests of the equipment present, keeps every run, and receives the building when all pass", async () => {
    const rearing = await building("r1", "ELEVAGE");
    const technician = await createTestSession("TECHNICIAN", "FARM", rearing.farm.id, "rc-tech");
    const run = (code: string, result: "CONFORME" | "NON_CONFORME", performedAt = "2025-02-17") =>
      recordCommissioning({ buildingId: rearing.building.id, code, result, performedAt, performedBy: "Y. Amrani (installateur)", measured: null, evidence: `PV-${code}`, notes: null }, technician, new Date("2025-03-01T10:00:00.000Z"));

    const start = await buildingCommissioning(rearing.building.id, technician);
    const codes = start.items.map((i) => i.recipe.code);
    expect(codes).toEqual(["A01", "A02", "A03", "A04", "A05", "A06", "B01", "B02", "C01", "C02", "C03", "C04", "C05", "D01", "D04", "E01", "E02", "F02", "L01", "L03", "O01"]);
    expect(start.items.find((i) => i.recipe.code === "A01")?.devices).toHaveLength(3);
    expect(start.status).toMatchObject({ applicable: 21, conforming: 0, complete: false });

    // A failed run, then the run after the cell was replaced: both kept, the latest decides.
    await run("A03", "NON_CONFORME");
    await new Promise((r) => setTimeout(r, 5));
    await recordCommissioning({ buildingId: rearing.building.id, code: "A03", result: "CONFORME", performedAt: "2025-02-24", performedBy: "Y. Amrani (installateur)", measured: "11 ppm pour 10", evidence: "PV-A03-bis", notes: null }, technician, new Date("2025-03-02T10:00:00.000Z"));
    const a03 = (await buildingCommissioning(rearing.building.id, technician)).items.find((i) => i.recipe.code === "A03")!;
    expect(a03.history.map((h) => h.result)).toEqual(["CONFORME", "NON_CONFORME"]);
    expect(a03.latest?.result).toBe("CONFORME");

    // A test of equipment the building does not have, a date to come, a reader out of scope: refused.
    expect(await refused(run("H06", "CONFORME"), "VALIDATION")).toMatch(/ne s'applique/);
    expect(await refused(run("A01", "CONFORME", "2025-03-05"), "VALIDATION")).toMatch(/futur/);
    const other = await building("r2", "ELEVAGE");
    const outsider = await createTestSession("TECHNICIAN", "FARM", other.farm.id, "rc-outsider");
    await refused(recordCommissioning({ buildingId: rearing.building.id, code: "A01", result: "CONFORME", performedAt: "2025-02-17", performedBy: "Quelqu'un", measured: null, evidence: "PV-X", notes: null }, outsider), "AUTHORIZATION");
    // The farm manager runs the building but does not certify its installation.
    const manager = await createTestSession("FARM_MANAGER", "FARM", rearing.farm.id, "rc-manager");
    await refused(recordCommissioning({ buildingId: rearing.building.id, code: "A01", result: "CONFORME", performedAt: "2025-02-17", performedBy: "Moi-même", measured: null, evidence: "PV-X", notes: null }, manager), "AUTHORIZATION");
    await run("A01", "CONFORME");
    expect((await commissioningOverview(outsider)).map((b) => b.buildingId)).toEqual([other.building.id]);

    for (const code of codes.filter((c) => c !== "A03" && c !== "A01")) await run(code, "CONFORME");
    const done = await buildingCommissioning(rearing.building.id, technician);
    expect(done.status).toEqual({ applicable: 21, conforming: 21, nonConforming: [], missing: [], complete: true });

    // The hatchery has its own tests: probes per incubator, the egg room, the logger.
    const hatchery = await building("h1", "COUVOIR");
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "rc-admin");
    expect((await buildingCommissioning(hatchery.building.id, admin)).items.map((i) => i.recipe.code)).toEqual(["H06", "H03", "H06b", "L01", "O01"]);
  });
});
