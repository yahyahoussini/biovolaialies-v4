import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { createTestSession } from "../production/test-support";
import {
  applyStructureImport,
  createBuilding,
  createCooperative,
  createFarm,
  createOrganization,
  createProducer,
  previewStructureImport,
  structureTree,
  updateStructure,
} from "./structure";

const HEADER = "organisation;type_organisation;cooperative;region_cooperative;producteur;telephone_producteur;email_producteur;ferme;ville;region_ferme;latitude;longitude;batiment_code;batiment_nom;capacite;type_zone";

describe("farm structure", () => {
  it("is built level by level by an administrator, with unique building codes and an audit trail", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "struct-admin-1");
    const org = await createOrganization({ name: "Groupe Atlas Volailles", type: "INTERNAL" }, admin);
    const coop = await createCooperative({ organizationId: org.id, name: "Coopérative Saïss", region: "Fès-Meknès" }, admin);
    const producer = await createProducer({ cooperativeId: coop.id, name: "Hassan Alaoui", contactPhone: "0661000000", contactEmail: "" }, admin);
    expect(producer.contactEmail).toBeNull();
    const farm = await createFarm({ producerId: producer.id, name: "Ferme Aïn Taoujdate", city: "Aïn Taoujdate", region: "Fès-Meknès", geoLat: 33.93, geoLng: -5.21 }, admin);
    const building = await createBuilding({ farmId: farm.id, code: "ATV-B01", name: "Poulailler 1", capacity: 6000, zoneType: "ELEVAGE" }, admin);
    expect(building.capacity).toBe(6000);
    await expect(createBuilding({ farmId: farm.id, code: "atv-b01", name: "Doublon", capacity: 100, zoneType: "ELEVAGE" }, admin)).rejects.toThrow(/déjà utilisé/);
    await expect(createBuilding({ farmId: farm.id, code: "ATV B02", name: "Espace", capacity: 100, zoneType: "ELEVAGE" }, admin)).rejects.toThrow(/sans espace/);

    await updateStructure("building", building.id, { code: "ATV-B01", name: "Poulailler principal", capacity: 6500, zoneType: "ELEVAGE" }, admin);
    expect((await repositories.buildings.findById(building.id))!).toMatchObject({ name: "Poulailler principal", capacity: 6500 });
    const trail = await repositories.auditLog.listByEntity("building", building.id);
    expect(trail.map((e) => e.reason)).toEqual(expect.arrayContaining(["Création d'un bâtiment", "Modification d'un bâtiment"]));
  });

  it("keeps a cooperative manager inside their cooperative", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "struct-admin-2");
    const org = await createOrganization({ name: "Org Périmètre", type: "COOPERATIVE" }, admin);
    const mine = await createCooperative({ organizationId: org.id, name: "Coop A", region: "Souss-Massa" }, admin);
    const other = await createCooperative({ organizationId: org.id, name: "Coop B", region: "Oriental" }, admin);
    const manager = await createTestSession("COOP_MANAGER", "COOPERATIVE", mine.id, "struct-coop-2");

    await expect(createOrganization({ name: "Interdite", type: "INTERNAL" }, manager)).rejects.toThrow(/droits/);
    const producer = await createProducer({ cooperativeId: mine.id, name: "Producteur A" }, manager);
    await expect(createProducer({ cooperativeId: other.id, name: "Producteur B" }, manager)).rejects.toThrow();
    await createFarm({ producerId: producer.id, name: "Ferme A", city: "Taroudant", region: "Souss-Massa" }, manager);

    const tree = await structureTree(manager);
    const coops = tree.organizations.flatMap((o) => o.cooperatives.map((c) => c.name));
    expect(coops).toContain("Coop A");
    expect(coops).not.toContain("Coop B");
  });

  it("imports a spreadsheet only when every line is right, and creates nothing twice", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "struct-admin-3");
    // The delivered template holds only its EXEMPLE line: nothing to import.
    const template = readFileSync("livraison/modeles/structure-elevages.csv", "utf8");
    expect(await previewStructureImport(template, admin)).toMatchObject({ rows: 0, skipped: 1, errors: [] });

    const csv = [
      HEADER,
      "Domaine Zaër;Interne;Coop Zaër;Rabat-Salé-Kénitra;Karim Bennani;0612345678;karim@zaer.ma;Ferme Oulad Hmid;Rommani;Rabat-Salé-Kénitra;33,53;-6,60;ZAE-B1;Bâtiment 1;5000;Élevage",
      "Domaine Zaër;Interne;Coop Zaër;Rabat-Salé-Kénitra;Karim Bennani;0612345678;karim@zaer.ma;Ferme Oulad Hmid;Rommani;Rabat-Salé-Kénitra;33,53;-6,60;ZAE-B2;Bâtiment 2;5000;ELEVAGE",
      "Domaine Zaër;Interne;Coop Zaër;;Fatima Idrissi;;;Ferme Sidi Bettache;Sidi Bettache;Rabat-Salé-Kénitra;;;ZAE-C1;Couvoir;12000;couvoir",
    ].join("\r\n");
    const preview = await previewStructureImport(csv, admin);
    expect(preview.errors).toEqual([]);
    expect(preview.create).toEqual({ organization: 1, cooperative: 1, producer: 2, farm: 2, building: 3 });

    // One wrong line, and nothing at all is written.
    const broken = `${csv}\r\nDomaine Zaër;Interne;Coop Zaër;;Fatima Idrissi;;;Ferme Sidi Bettache;Sidi Bettache;Rabat-Salé-Kénitra;;;ZAE-C2;Hangar;beaucoup;Hangar`;
    const refused = await applyStructureImport(broken, admin);
    expect(refused.errors).toEqual([{ line: 5, message: expect.stringMatching(/type_zone inconnu.*capacite invalide|capacite invalide|type_zone inconnu/) }]);
    expect((await repositories.organizations.list()).some((o) => o.name === "Domaine Zaër")).toBe(false);

    const done = await applyStructureImport(csv, admin);
    expect(done.errors).toEqual([]);
    const farm = (await repositories.farms.list()).find((f) => f.name === "Ferme Oulad Hmid")!;
    expect(farm).toMatchObject({ city: "Rommani", geoLat: 33.53, geoLng: -6.6 });
    expect((await repositories.buildings.listByFarm(farm.id)).map((b) => b.code).sort()).toEqual(["ZAE-B1", "ZAE-B2"]);

    // The same file again: everything is found, nothing is added.
    const again = await previewStructureImport(csv, admin);
    expect(again.create).toEqual({ organization: 0, cooperative: 0, producer: 0, farm: 0, building: 0 });
    expect(again.existing).toEqual({ organization: 1, cooperative: 1, producer: 2, farm: 2, building: 3 });
    await applyStructureImport(csv, admin);
    expect((await repositories.organizations.list()).filter((o) => o.name === "Domaine Zaër")).toHaveLength(1);

    // A building code already used by another farm is refused, not moved.
    const clash = `${HEADER}\r\nDomaine Zaër;Interne;Coop Zaër;;Fatima Idrissi;;;Ferme Sidi Bettache;Sidi Bettache;Rabat-Salé-Kénitra;;;ZAE-B1;Autre;100;Autre`;
    expect((await previewStructureImport(clash, admin)).errors[0].message).toMatch(/déjà utilisé par une autre ferme/);
  });

  it("names the missing columns of a file that is not the template", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "struct-admin-4");
    const preview = await previewStructureImport("nom;ville\nFerme;Fès", admin);
    expect(preview.errors[0].message).toMatch(/Colonnes manquantes : organisation/);
  });
});
