import { repositories } from "../../data/repositories";
import type { Building, Cooperative, Farm, Organization, Producer } from "../../domain/identity/types";
import { BUILDING_ZONE_TYPE, ORGANIZATION_TYPE, type BuildingZoneType, type OrganizationType } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError } from "../../domain/shared/errors";
import { can, type Module } from "../../domain/shared/permissions";
import { parseInput, z } from "../../lib/zod";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import {
  assertInScope,
  isWithinScope,
  resolveBuildingHierarchy,
  resolveCooperativeHierarchy,
  resolveFarmHierarchy,
  resolveProducerHierarchy,
  type HierarchyPath,
} from "./scope-check";

/**
 * The farm structure of a real installation — organisation → cooperative → producer → farm →
 * building — entered in the application or imported from a spreadsheet. Each level checks the
 * permission matrix (CREATE/EDIT on its module) and the caller's scope on the parent, and every
 * change goes to the audit trail with its before and after.
 */

const name = z.string().trim().min(1, "Nom requis.").max(200, "200 caractères maximum.");
const region = z.string().trim().min(1, "Région requise.").max(100);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const organizationInput = z.object({ name, type: z.enum(ORGANIZATION_TYPE) });
export const cooperativeInput = z.object({ organizationId: z.string().min(1), name, region });
export const producerInput = z.object({
  cooperativeId: z.string().min(1),
  name,
  contactPhone: optionalText(40),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email invalide."),
});
export const farmInput = z.object({
  producerId: z.string().min(1),
  name,
  city: z.string().trim().min(1, "Ville requise.").max(100),
  region,
  geoLat: z.number().min(-90).max(90).nullish().transform((v) => v ?? null),
  geoLng: z.number().min(-180).max(180).nullish().transform((v) => v ?? null),
});
export const buildingInput = z.object({
  farmId: z.string().min(1),
  code: z
    .string()
    .trim()
    .min(1, "Code requis.")
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, "Code : lettres, chiffres, tiret, point ou soulignement, sans espace."),
  name,
  capacity: z.number().int("Capacité : un nombre entier.").positive("Capacité : un nombre positif.").max(1_000_000),
  zoneType: z.enum(BUILDING_ZONE_TYPE),
});

export type StructureLevel = "organization" | "cooperative" | "producer" | "farm" | "building";
const MODULE_OF: Record<StructureLevel, Module> = {
  organization: "ORGANIZATIONS",
  cooperative: "COOPERATIVES",
  producer: "PRODUCERS",
  farm: "FARMS",
  building: "BUILDINGS",
};
const LABEL: Record<StructureLevel, string> = { organization: "organisation", cooperative: "coopérative", producer: "producteur", farm: "ferme", building: "bâtiment" };

function allow(session: Session, action: "CREATE" | "EDIT", level: StructureLevel): void {
  if (!can(session, action, MODULE_OF[level])) {
    throw new AuthorizationError(`Vous n'avez pas les droits pour ${action === "CREATE" ? "créer" : "modifier"} : ${LABEL[level]}.`);
  }
}

async function audit(session: Session, entityType: string, entityId: string, oldValue: unknown, newValue: unknown, reason: string) {
  await recordAudit({
    actorId: session.userId,
    entityType,
    entityId,
    field: null,
    oldValue: oldValue === null ? null : JSON.stringify(oldValue),
    newValue: JSON.stringify(newValue),
    reason,
    relatedLotId: null,
    relatedEventId: null,
  });
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("fr") === b.trim().toLocaleLowerCase("fr");

async function assertBuildingCodeFree(code: string, exceptId?: string): Promise<void> {
  const taken = (await repositories.buildings.list()).find((b) => same(b.code, code) && b.id !== exceptId);
  if (taken) throw new ConflictError(`Le code de bâtiment « ${code} » est déjà utilisé.`);
}

export async function createOrganization(input: unknown, session: Session): Promise<Organization> {
  allow(session, "CREATE", "organization");
  if (session.scopeType !== "GLOBAL") throw new AuthorizationError("Une organisation se crée avec un périmètre global.");
  const data = parseInput(organizationInput, input);
  const row = await repositories.organizations.create(data);
  await audit(session, "organization", row.id, null, data, "Création d'une organisation");
  return row;
}

export async function createCooperative(input: unknown, session: Session): Promise<Cooperative> {
  allow(session, "CREATE", "cooperative");
  const data = parseInput(cooperativeInput, input);
  if (!(await repositories.organizations.findById(data.organizationId))) throw new NotFoundError("Organisation", data.organizationId);
  assertInScope(session, { organizationId: data.organizationId });
  const row = await repositories.cooperatives.create(data);
  await audit(session, "cooperative", row.id, null, data, "Création d'une coopérative");
  return row;
}

export async function createProducer(input: unknown, session: Session): Promise<Producer> {
  allow(session, "CREATE", "producer");
  const data = parseInput(producerInput, input);
  if (!(await repositories.cooperatives.findById(data.cooperativeId))) throw new NotFoundError("Coopérative", data.cooperativeId);
  assertInScope(session, await resolveCooperativeHierarchy(data.cooperativeId));
  const row = await repositories.producers.create(data);
  await audit(session, "producer", row.id, null, data, "Création d'un producteur");
  return row;
}

export async function createFarm(input: unknown, session: Session): Promise<Farm> {
  allow(session, "CREATE", "farm");
  const data = parseInput(farmInput, input);
  if (!(await repositories.producers.findById(data.producerId))) throw new NotFoundError("Producteur", data.producerId);
  assertInScope(session, await resolveProducerHierarchy(data.producerId));
  const row = await repositories.farms.create(data);
  await audit(session, "farm", row.id, null, data, "Création d'une ferme");
  return row;
}

export async function createBuilding(input: unknown, session: Session): Promise<Building> {
  allow(session, "CREATE", "building");
  const data = parseInput(buildingInput, input);
  if (!(await repositories.farms.findById(data.farmId))) throw new NotFoundError("Ferme", data.farmId);
  assertInScope(session, await resolveFarmHierarchy(data.farmId));
  await assertBuildingCodeFree(data.code);
  const row = await repositories.buildings.create(data);
  await audit(session, "building", row.id, null, data, "Création d'un bâtiment");
  return row;
}

/** Edits keep each record under its parent: moving a farm to another producer is not an edit. */
export async function updateStructure(level: StructureLevel, id: string, input: unknown, session: Session): Promise<void> {
  allow(session, "EDIT", level);
  switch (level) {
    case "organization": {
      const before = await repositories.organizations.findById(id);
      if (!before) throw new NotFoundError("Organisation", id);
      assertInScope(session, { organizationId: id });
      const data = parseInput(organizationInput, input);
      await repositories.organizations.update(id, data);
      return audit(session, "organization", id, { name: before.name, type: before.type }, data, "Modification d'une organisation");
    }
    case "cooperative": {
      const before = await repositories.cooperatives.findById(id);
      if (!before) throw new NotFoundError("Coopérative", id);
      assertInScope(session, await resolveCooperativeHierarchy(id));
      const data = parseInput(cooperativeInput.omit({ organizationId: true }), input);
      await repositories.cooperatives.update(id, data);
      return audit(session, "cooperative", id, { name: before.name, region: before.region }, data, "Modification d'une coopérative");
    }
    case "producer": {
      const before = await repositories.producers.findById(id);
      if (!before) throw new NotFoundError("Producteur", id);
      assertInScope(session, await resolveProducerHierarchy(id));
      const data = parseInput(producerInput.omit({ cooperativeId: true }), input);
      await repositories.producers.update(id, data);
      return audit(session, "producer", id, { name: before.name, contactPhone: before.contactPhone, contactEmail: before.contactEmail }, data, "Modification d'un producteur");
    }
    case "farm": {
      const before = await repositories.farms.findById(id);
      if (!before) throw new NotFoundError("Ferme", id);
      assertInScope(session, await resolveFarmHierarchy(id));
      const data = parseInput(farmInput.omit({ producerId: true }), input);
      await repositories.farms.update(id, data);
      return audit(session, "farm", id, { name: before.name, city: before.city, region: before.region, geoLat: before.geoLat, geoLng: before.geoLng }, data, "Modification d'une ferme");
    }
    case "building": {
      const before = await repositories.buildings.findById(id);
      if (!before) throw new NotFoundError("Bâtiment", id);
      assertInScope(session, await resolveBuildingHierarchy(id));
      const data = parseInput(buildingInput.omit({ farmId: true }), input);
      await assertBuildingCodeFree(data.code, id);
      await repositories.buildings.update(id, data);
      return audit(session, "building", id, { code: before.code, name: before.name, capacity: before.capacity, zoneType: before.zoneType }, data, "Modification d'un bâtiment");
    }
  }
}

export interface StructureTree {
  organizations: (Organization & {
    cooperatives: (Cooperative & { producers: (Producer & { farms: (Farm & { buildings: Building[] })[] })[] })[];
  })[];
}

/** The structure the caller may see, nested, each level sorted by name. */
export async function structureTree(session: Session): Promise<StructureTree> {
  const [orgs, coops, producers, farms, buildings] = await Promise.all([
    repositories.organizations.list(),
    repositories.cooperatives.list(),
    repositories.producers.list(),
    repositories.farms.list(),
    repositories.buildings.list(),
  ]);
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "fr");
  const visible = (path: HierarchyPath) => isWithinScope(session, path);
  return {
    organizations: orgs.sort(byName).flatMap((o) => {
      const cooperatives = coops
        .filter((c) => c.organizationId === o.id)
        .sort(byName)
        .map((c) => ({
          ...c,
          producers: producers
            .filter((p) => p.cooperativeId === c.id)
            .sort(byName)
            .map((p) => ({
              ...p,
              farms: farms
                .filter((f) => f.producerId === p.id && visible({ organizationId: o.id, cooperativeId: c.id, producerId: p.id, farmId: f.id }))
                .sort(byName)
                .map((f) => ({ ...f, buildings: buildings.filter((b) => b.farmId === f.id).sort((a, b) => a.code.localeCompare(b.code, "fr")) })),
            }))
            .filter((p) => p.farms.length > 0 || visible({ organizationId: o.id, cooperativeId: c.id, producerId: p.id })),
        }))
        .filter((c) => c.producers.length > 0 || visible({ organizationId: o.id, cooperativeId: c.id }));
      return cooperatives.length > 0 || visible({ organizationId: o.id }) ? [{ ...o, cooperatives }] : [];
    }),
  };
}

// ---------------------------------------------------------------------------
// Spreadsheet import (livraison/modeles/structure-elevages.csv)
// ---------------------------------------------------------------------------

export const STRUCTURE_COLUMNS = [
  "organisation",
  "type_organisation",
  "cooperative",
  "region_cooperative",
  "producteur",
  "telephone_producteur",
  "email_producteur",
  "ferme",
  "ville",
  "region_ferme",
  "latitude",
  "longitude",
  "batiment_code",
  "batiment_nom",
  "capacite",
  "type_zone",
] as const;

const ORG_TYPE_WORDS: Record<string, OrganizationType> = {
  "": "INTERNAL",
  interne: "INTERNAL",
  internal: "INTERNAL",
  cooperative: "COOPERATIVE",
  "groupement de producteurs": "PRODUCER_GROUP",
  groupement: "PRODUCER_GROUP",
  producer_group: "PRODUCER_GROUP",
};
const ZONE_WORDS: Record<string, BuildingZoneType> = { elevage: "ELEVAGE", couvoir: "COUVOIR", stockage: "STOCKAGE", autre: "AUTRE" };

/** Lower case, no accents, single spaces: "Élevage" and "ELEVAGE" are the same word. */
const fold = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

const decimal = (v: string): number | null | "invalid" => {
  if (!v) return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : "invalid";
};

interface ImportRow {
  line: number;
  organisation: string;
  organisationType: OrganizationType;
  cooperative: string;
  cooperativeRegion: string;
  producer: string;
  phone: string | null;
  email: string | null;
  farm: string;
  city: string;
  farmRegion: string;
  geoLat: number | null;
  geoLng: number | null;
  buildingCode: string;
  buildingName: string;
  capacity: number;
  zoneType: BuildingZoneType;
}

export interface StructureImportPreview {
  rows: number;
  skipped: number;
  errors: { line: number; message: string }[];
  create: Record<StructureLevel, number>;
  existing: Record<StructureLevel, number>;
}

function parseStructureCsv(text: string): { rows: ImportRow[]; skipped: number; errors: { line: number; message: string }[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerIndex < 0) return { rows: [], skipped: 0, errors: [{ line: 1, message: "Fichier vide." }] };
  const headerLine = lines[headerIndex];
  const delimiter = (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitCsvLine(headerLine, delimiter).map(fold);
  const missing = STRUCTURE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], skipped: 0, errors: [{ line: headerIndex + 1, message: `Colonnes manquantes : ${missing.join(", ")}. Utilisez le modèle structure-elevages.csv.` }] };
  const col = Object.fromEntries(STRUCTURE_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof STRUCTURE_COLUMNS)[number], number>;

  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  let skipped = 0;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === "" || /^[;,\s]*$/.test(lines[i])) continue;
    const cells = splitCsvLine(lines[i], delimiter);
    const get = (c: (typeof STRUCTURE_COLUMNS)[number]) => cells[col[c]] ?? "";
    if (fold(get("organisation")).startsWith("exemple")) {
      skipped++;
      continue;
    }
    const line = i + 1;
    const problems: string[] = [];
    const required = { organisation: get("organisation"), cooperative: get("cooperative"), producteur: get("producteur"), ferme: get("ferme"), ville: get("ville"), region_ferme: get("region_ferme"), batiment_code: get("batiment_code"), batiment_nom: get("batiment_nom") };
    for (const [key, value] of Object.entries(required)) if (!value) problems.push(`${key} vide`);
    const orgType = ORG_TYPE_WORDS[fold(get("type_organisation"))];
    if (!orgType) problems.push(`type_organisation inconnu « ${get("type_organisation")} » (Interne, Coopérative ou Groupement de producteurs)`);
    const zone = ZONE_WORDS[fold(get("type_zone"))];
    if (!zone) problems.push(`type_zone inconnu « ${get("type_zone")} » (Élevage, Couvoir, Stockage ou Autre)`);
    const capacity = Number(get("capacite").replace(/\s/g, ""));
    if (!Number.isInteger(capacity) || capacity <= 0) problems.push(`capacite invalide « ${get("capacite")} »`);
    const lat = decimal(get("latitude"));
    const lng = decimal(get("longitude"));
    if (lat === "invalid" || (lat !== null && Math.abs(lat) > 90)) problems.push("latitude invalide");
    if (lng === "invalid" || (lng !== null && Math.abs(lng) > 180)) problems.push("longitude invalide");
    const email = get("email_producteur") || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email_producteur invalide « ${email} »`);
    if (get("batiment_code") && !/^[A-Za-z0-9._-]+$/.test(get("batiment_code"))) problems.push(`batiment_code « ${get("batiment_code")} » : lettres, chiffres, tiret, point ou soulignement`);
    if (problems.length) {
      errors.push({ line, message: problems.join(" ; ") });
      continue;
    }
    rows.push({
      line,
      organisation: get("organisation"),
      organisationType: orgType!,
      cooperative: get("cooperative"),
      cooperativeRegion: get("region_cooperative") || get("region_ferme"),
      producer: get("producteur"),
      phone: get("telephone_producteur") || null,
      email,
      farm: get("ferme"),
      city: get("ville"),
      farmRegion: get("region_ferme"),
      geoLat: lat as number | null,
      geoLng: lng as number | null,
      buildingCode: get("batiment_code"),
      buildingName: get("batiment_nom"),
      capacity,
      zoneType: zone!,
    });
  }
  return { rows, skipped, errors };
}

/** Builds the plan against what exists: what will be created, what is already there, what is wrong. Writes nothing. */
async function planImport(text: string, session: Session) {
  const parsed = parseStructureCsv(text);
  const errors = [...parsed.errors];
  const [orgs, coops, producers, farms, buildings] = await Promise.all([
    repositories.organizations.list(),
    repositories.cooperatives.list(),
    repositories.producers.list(),
    repositories.farms.list(),
    repositories.buildings.list(),
  ]);
  const create = { organization: new Set<string>(), cooperative: new Set<string>(), producer: new Set<string>(), farm: new Set<string>(), building: new Set<string>() };
  const existing = { organization: new Set<string>(), cooperative: new Set<string>(), producer: new Set<string>(), farm: new Set<string>(), building: new Set<string>() };
  const seenCodes = new Map<string, string>();
  for (const r of parsed.rows) {
    const orgKey = fold(r.organisation);
    const coopKey = `${orgKey}|${fold(r.cooperative)}`;
    const prodKey = `${coopKey}|${fold(r.producer)}`;
    const farmKey = `${prodKey}|${fold(r.farm)}`;
    const org = orgs.find((o) => same(o.name, r.organisation));
    const coop = org ? coops.find((c) => c.organizationId === org.id && same(c.name, r.cooperative)) : undefined;
    const prod = coop ? producers.find((p) => p.cooperativeId === coop.id && same(p.name, r.producer)) : undefined;
    const farm = prod ? farms.find((f) => f.producerId === prod.id && same(f.name, r.farm)) : undefined;
    const problems: string[] = [];

    (org ? existing : create).organization.add(orgKey);
    (coop ? existing : create).cooperative.add(coopKey);
    (prod ? existing : create).producer.add(prodKey);
    (farm ? existing : create).farm.add(farmKey);
    if (!org && (!can(session, "CREATE", "ORGANIZATIONS") || session.scopeType !== "GLOBAL")) problems.push(`droits insuffisants pour créer l'organisation « ${r.organisation} »`);
    if (!coop && !can(session, "CREATE", "COOPERATIVES")) problems.push("droits insuffisants pour créer une coopérative");
    if (!prod && !can(session, "CREATE", "PRODUCERS")) problems.push("droits insuffisants pour créer un producteur");
    if (!farm && !can(session, "CREATE", "FARMS")) problems.push("droits insuffisants pour créer une ferme");
    // The deepest level that already exists must be in the caller's scope.
    const anchor: HierarchyPath | null = farm
      ? await resolveFarmHierarchy(farm.id)
      : prod
        ? await resolveProducerHierarchy(prod.id)
        : coop
          ? await resolveCooperativeHierarchy(coop.id)
          : org
            ? { organizationId: org.id }
            : null;
    if (anchor && !isWithinScope(session, anchor)) problems.push("hors de votre périmètre");

    const codeKey = fold(r.buildingCode);
    const building = buildings.find((b) => same(b.code, r.buildingCode));
    if (building) {
      if (!farm || building.farmId !== farm.id) problems.push(`code de bâtiment « ${r.buildingCode} » déjà utilisé par une autre ferme`);
      else existing.building.add(codeKey);
    } else if (seenCodes.has(codeKey) && seenCodes.get(codeKey) !== farmKey) {
      problems.push(`code de bâtiment « ${r.buildingCode} » répété pour deux fermes du fichier`);
    } else {
      if (!can(session, "CREATE", "BUILDINGS")) problems.push("droits insuffisants pour créer un bâtiment");
      create.building.add(codeKey);
    }
    seenCodes.set(codeKey, farmKey);
    if (problems.length) errors.push({ line: r.line, message: problems.join(" ; ") });
  }
  const count = (s: typeof create) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.size])) as Record<StructureLevel, number>;
  return { rows: parsed.rows, skipped: parsed.skipped, errors: errors.sort((a, b) => a.line - b.line), create: count(create), existing: count(existing) };
}

export async function previewStructureImport(text: string, session: Session): Promise<StructureImportPreview> {
  const plan = await planImport(text, session);
  return { rows: plan.rows.length, skipped: plan.skipped, errors: plan.errors, create: plan.create, existing: plan.existing };
}

/**
 * Imports the file: all or nothing at the checking stage — a single error and nothing is written.
 * Re-running the same file creates nothing new (items are found by name within their parent, and
 * buildings by code), so an interrupted import is finished by importing the file again.
 */
export async function applyStructureImport(text: string, session: Session): Promise<StructureImportPreview> {
  const plan = await planImport(text, session);
  if (plan.errors.length) return { rows: plan.rows.length, skipped: plan.skipped, errors: plan.errors, create: plan.create, existing: plan.existing };
  for (const r of plan.rows) {
    const orgs = await repositories.organizations.list();
    const org = orgs.find((o) => same(o.name, r.organisation)) ?? (await createOrganization({ name: r.organisation, type: r.organisationType }, session));
    const coop = (await repositories.cooperatives.listByOrganization(org.id)).find((c) => same(c.name, r.cooperative)) ?? (await createCooperative({ organizationId: org.id, name: r.cooperative, region: r.cooperativeRegion }, session));
    const prod = (await repositories.producers.listByCooperative(coop.id)).find((p) => same(p.name, r.producer)) ?? (await createProducer({ cooperativeId: coop.id, name: r.producer, contactPhone: r.phone, contactEmail: r.email }, session));
    const farm = (await repositories.farms.listByProducer(prod.id)).find((f) => same(f.name, r.farm)) ?? (await createFarm({ producerId: prod.id, name: r.farm, city: r.city, region: r.farmRegion, geoLat: r.geoLat, geoLng: r.geoLng }, session));
    const exists = (await repositories.buildings.list()).some((b) => same(b.code, r.buildingCode));
    if (!exists) await createBuilding({ farmId: farm.id, code: r.buildingCode, name: r.buildingName, capacity: r.capacity, zoneType: r.zoneType }, session);
  }
  return { rows: plan.rows.length, skipped: plan.skipped, errors: [], create: plan.create, existing: plan.existing };
}
