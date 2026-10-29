import { repositories } from "../../data/repositories";
import type { Device } from "../../domain/iot/types";
import { COMMISSIONING_RECIPES, receptionStatus, recipeFor, type CommissioningRecipe, type CommissioningRecord, type ReceptionStatus } from "../../domain/equipment/recipes";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { moroccoDate } from "../../lib/dates";
import { parseInput, z } from "../../lib/zod";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, isWithinScope, resolveBuildingHierarchy } from "../identity/scope-check";

/**
 * Commissioning per building (document 2, annex A). The tests that apply to a building are those of
 * the equipment it actually has; a building is received when each of them has been run and recorded
 * as conforming — the condition of the installer's final payment.
 */

/** Recipe codes that apply to a set of devices, in the annex's order. */
function applicableCodes(devices: Device[]): string[] {
  const refs = new Set(devices.map((d) => d.catalogRef).filter((r): r is string => !!r));
  return COMMISSIONING_RECIPES.filter((r) => refs.has(r.code)).map((r) => r.code);
}

/** The current result of each test: records come latest run first. */
function latestByCode(records: CommissioningRecord[]): Map<string, CommissioningRecord> {
  const out = new Map<string, CommissioningRecord>();
  for (const r of records) if (!out.has(r.code)) out.set(r.code, r);
  return out;
}

export interface BuildingReception {
  buildingId: string;
  buildingLabel: string;
  status: ReceptionStatus;
}

/** Instrumented buildings the reader may see, with where their reception stands. */
export async function commissioningOverview(session: Session): Promise<BuildingReception[]> {
  if (!can(session, "VIEW", "EQUIPMENT") && !can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const devices = await repositories.devices.list();
  const out: BuildingReception[] = [];
  for (const building of await repositories.buildings.list()) {
    const codes = applicableCodes(devices.filter((d) => d.buildingId === building.id));
    if (codes.length === 0) continue;
    if (!isWithinScope(session, await resolveBuildingHierarchy(building.id))) continue;
    const latest = latestByCode(await repositories.commissioning.listByBuilding(building.id));
    out.push({ buildingId: building.id, buildingLabel: `${building.name} (${building.code})`, status: receptionStatus(codes, latest) });
  }
  return out;
}

export interface CommissioningItem {
  recipe: CommissioningRecipe;
  devices: string[];
  latest: CommissioningRecord | null;
  history: (CommissioningRecord & { recordedByName: string })[];
}

export async function buildingCommissioning(buildingId: string, session: Session): Promise<{ buildingLabel: string; items: CommissioningItem[]; status: ReceptionStatus }> {
  if (!can(session, "VIEW", "EQUIPMENT") && !can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const building = await repositories.buildings.findById(buildingId);
  if (!building) throw new NotFoundError("Bâtiment", buildingId);
  assertInScope(session, await resolveBuildingHierarchy(buildingId));
  const devices = (await repositories.devices.list()).filter((d) => d.buildingId === buildingId);
  const codes = applicableCodes(devices);
  const [records, users] = await Promise.all([repositories.commissioning.listByBuilding(buildingId), repositories.users.list()]);
  const latest = latestByCode(records);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    buildingLabel: `${building.name} (${building.code})`,
    items: codes.map((code) => ({
      recipe: recipeFor(code)!,
      devices: devices.filter((d) => d.catalogRef === code).map((d) => d.code),
      latest: latest.get(code) ?? null,
      history: records.filter((r) => r.code === code).map((r) => ({ ...r, recordedByName: name.get(r.recordedBy) ?? "—" })),
    })),
    status: receptionStatus(codes, latest),
  };
}

/**
 * The current result of each test of a building and where its reception stands, counted on its
 * equipment (cameras, alarm and access control included, though they carry no measuring channel).
 * For screens that have already checked the reader may see the building.
 */
export async function commissioningResults(buildingId: string): Promise<{ latest: Map<string, CommissioningRecord>; status: ReceptionStatus }> {
  const devices = (await repositories.devices.list()).filter((d) => d.buildingId === buildingId);
  const latest = latestByCode(await repositories.commissioning.listByBuilding(buildingId));
  return { latest, status: receptionStatus(applicableCodes(devices), latest) };
}

const recordSchema = z.object({
  buildingId: z.string().trim().min(1),
  code: z.string().trim().min(1),
  result: z.enum(["CONFORME", "NON_CONFORME"]),
  performedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date d'exécution attendue (AAAA-MM-JJ)."),
  performedBy: z.string().trim().min(3, "Nom de la personne qui a exécuté le test.").max(120),
  measured: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .transform((v) => (v ? v : null)),
  evidence: z.string().trim().min(3, "Une preuve (PV, photo, relevé) est requise.").max(500),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((v) => (v ? v : null)),
});

/**
 * Records a test run. Append-only: a re-test after a correction is a new record, and the failed run
 * stays in the history. Recorded by whoever validates installations (the technician), within their
 * scope; the person who ran the test is named, with the day it was run.
 */
export async function recordCommissioning(input: unknown, session: Session, now = new Date()): Promise<CommissioningRecord> {
  if (!can(session, "VALIDATE", "IOT")) throw new AuthorizationError("Consigner une recette est réservé à qui valide les installations (technicien).");
  const data = parseInput(recordSchema, input);
  const building = await repositories.buildings.findById(data.buildingId);
  if (!building) throw new NotFoundError("Bâtiment", data.buildingId);
  assertInScope(session, await resolveBuildingHierarchy(building.id));
  const devices = (await repositories.devices.list()).filter((d) => d.buildingId === building.id);
  if (!applicableCodes(devices).includes(data.code)) throw new ValidationError(`La recette ${data.code} ne s'applique à aucun équipement de ce bâtiment.`);
  // Compared with the day in Morocco: at 00:30 local time the UTC date is still yesterday.
  if (data.performedAt > moroccoDate(now)) throw new ValidationError("La date d'exécution ne peut pas être dans le futur.");
  const previous = (await commissioningResults(building.id)).latest.get(data.code) ?? null;
  const record = await repositories.commissioning.create({ ...data, performedAt: data.performedAt, recordedBy: session.userId, recordedAt: now.toISOString() });
  await recordAudit({
    actorId: session.userId,
    entityType: "commissioning_record",
    entityId: record.id,
    field: data.code,
    oldValue: previous ? previous.result : "À faire",
    newValue: data.result,
    reason: `Recette ${data.code} — ${building.code} — exécutée le ${data.performedAt} par ${data.performedBy} — preuve : ${data.evidence}`,
    relatedLotId: null,
    relatedEventId: null,
  });
  return record;
}
