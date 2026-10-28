import { z, parseInput } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { BVU_KIND, newBvuId, normalizeBvuId, parseBvuId, type BvuObjectType } from "../../domain/identity/bvu-id";
import type { IdentifierAlias } from "../../domain/production/flow";
import { normalizeTag } from "../../domain/production/flow";
import { parseShellCode } from "../../domain/marking/marking";
import { ID_ALIAS_SCHEME } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { ENTITY_TYPE, isEntityType } from "../../domain/traceability/entity-types";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { findEntityIdByCode } from "../traceability/lookup";

/**
 * Gives an object its BIOVOLAILLES identifier, once. Idempotent: an object that already has one
 * keeps it, whatever the number of calls, so a retried request never mints a second identity.
 */
export async function assignBvuId(objectType: BvuObjectType, objectId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await repositories.bvuIds.findByObject(objectType, objectId);
    if (existing) return existing.bvuId;
    if (await repositories.bvuIds.insertIfAbsent({ bvuId: newBvuId(objectType), objectType, objectId })) {
      const stored = await repositories.bvuIds.findByObject(objectType, objectId);
      if (stored) return stored.bvuId;
    }
  }
  throw new ConflictError("Impossible d'attribuer un identifiant BIOVOLAILLES : réessayez.");
}

/** Identifiers of several objects of one type; objects without one get it now. */
export async function bvuIdsFor(objectType: BvuObjectType, objectIds: string[]): Promise<Map<string, string>> {
  const found = new Map((await repositories.bvuIds.listByObjects(objectType, objectIds)).map((r) => [r.objectId, r.bvuId]));
  for (const id of objectIds) if (!found.has(id)) found.set(id, await assignBvuId(objectType, id));
  return found;
}

export interface ResolvedIdentifier {
  objectType: string;
  objectId: string;
  bvuId: string | null;
  /** How the code was recognised — our identifier, an alias, the object's business code, or a code printed on a shell. */
  via: "BVU" | "ALIAS" | "CODE_METIER" | "COQUILLE";
  alias?: IdentifierAlias;
  /** Shell codes: the marking run that printed it. */
  markingRunId?: string;
}

/**
 * Turns whatever a person typed or a reader scanned into the object it names: our identifier
 * (check digit verified), an active alias (supplier code, ring, chip), or a business code.
 * A BIOVOLAILLES code with a wrong check digit is refused, never guessed.
 */
export async function resolveIdentifier(raw: string): Promise<ResolvedIdentifier[]> {
  const code = raw.trim();
  if (!code) return [];
  const parsed = parseBvuId(code);
  if (parsed) {
    if (!parsed.valid) throw new ValidationError("Code BIOVOLAILLES illisible : le chiffre de contrôle ne correspond pas. Relisez ou rescannez le code.");
    const record = await repositories.bvuIds.find(normalizeBvuId(code));
    return record ? [{ objectType: record.objectType, objectId: record.objectId, bvuId: record.bvuId, via: "BVU" }] : [];
  }
  // A code printed on a shell names the eggs it was printed on (route B: a collection; route A: an egg lot).
  const shell = parseShellCode(code);
  const line = shell ? await repositories.marking.findLineByPrefix(shell.prefix) : null;
  if (shell && line) {
    if (!shell.valid) throw new ValidationError("Code de coquille illisible : le caractère de contrôle ne correspond pas. Relisez le code.");
    const run = await repositories.marking.findRunBySerial(line.id, shell.serial);
    if (run) return [{ objectType: run.sourceType, objectId: run.sourceId, bvuId: (await repositories.bvuIds.findByObject(run.sourceType, run.sourceId))?.bvuId ?? null, via: "COQUILLE", markingRunId: run.id }];
  }
  const aliases = [...(await repositories.identifierAliases.findActiveByValue(code)), ...(await repositories.identifierAliases.findActiveByValue(normalizeTag(code)))];
  const seen = new Set<string>();
  const out: ResolvedIdentifier[] = [];
  for (const alias of aliases) {
    if (seen.has(alias.id)) continue;
    seen.add(alias.id);
    const record = await repositories.bvuIds.find(alias.bvuId);
    if (record) out.push({ objectType: record.objectType, objectId: record.objectId, bvuId: record.bvuId, via: "ALIAS", alias });
  }
  if (out.length) return out;
  for (const type of ENTITY_TYPE) {
    const id = await findEntityIdByCode(type, code);
    if (id) out.push({ objectType: type, objectId: id, bvuId: (await repositories.bvuIds.findByObject(type, id))?.bvuId ?? null, via: "CODE_METIER" });
  }
  const subject = (await repositories.subjects.findByVisualId(normalizeTag(code))) ?? (await repositories.subjects.findByRfid(normalizeTag(code)));
  if (subject) out.push({ objectType: "SUBJECT", objectId: subject.id, bvuId: subject.bvuId, via: "CODE_METIER" });
  const tableEggs = await repositories.tableEggLots.findByCode(code);
  if (tableEggs) out.push({ objectType: "TABLE_EGG_LOT", objectId: tableEggs.id, bvuId: (await repositories.bvuIds.findByObject("TABLE_EGG_LOT", tableEggs.id))?.bvuId ?? null, via: "CODE_METIER" });
  return out;
}

export const addAliasSchema = z.object({
  bvuId: z.string().trim().min(1),
  scheme: z.enum(ID_ALIAS_SCHEME),
  issuer: z.string().trim().max(120).optional().default(""),
  value: z.string().trim().min(1, "Le code est requis.").max(120),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Records another party's code for one of our objects. Chips and rings name a single bird, so an
 * active one cannot point at two objects; a supplier code is unique per supplier.
 */
export async function addIdentifierAlias(input: unknown, session: Session): Promise<IdentifierAlias> {
  if (!can(session, "EDIT", "TRACEABILITY") && !can(session, "CREATE", "HATCHERY")) throw new AuthorizationError();
  const data = parseInput(addAliasSchema, input);
  const bvuId = normalizeBvuId(data.bvuId);
  const record = await repositories.bvuIds.find(bvuId);
  if (!record) throw new NotFoundError("Identifiant BIOVOLAILLES", bvuId);
  const value = data.scheme === "RFID" || data.scheme === "BAGUE" ? normalizeTag(data.value) : data.value;
  const clash = await repositories.identifierAliases.findActive(data.scheme, value, data.scheme === "FOURNISSEUR" ? data.issuer : undefined);
  if (clash.some((a) => a.bvuId !== bvuId)) throw new ConflictError(`Le code ${value} désigne déjà un autre objet : retirez d'abord l'ancien rattachement.`);
  if (clash.some((a) => a.bvuId === bvuId)) throw new ConflictError("Ce code est déjà rattaché à cet objet.");
  const alias = await repositories.identifierAliases.create({
    bvuId,
    scheme: data.scheme,
    issuer: data.issuer,
    value,
    validFrom: new Date().toISOString(),
    validTo: null,
    reason: data.reason ?? null,
    createdBy: session.userId,
  });
  await recordAudit({ actorId: session.userId, entityType: "identifier_alias", entityId: alias.id, field: null, oldValue: null, newValue: `${data.scheme}${data.issuer ? ` (${data.issuer})` : ""} ${value} → ${bvuId}`, reason: data.reason || "Rattachement d'un code externe", relatedLotId: null, relatedEventId: null });
  return alias;
}

export async function retireIdentifierAlias(aliasId: string, reason: string, session: Session): Promise<IdentifierAlias> {
  if (!can(session, "VALIDATE", "TRACEABILITY") && !can(session, "EDIT", "HATCHERY")) throw new AuthorizationError();
  if (reason.trim().length < 10) throw new ValidationError("Le retrait d'un code se justifie (10 caractères au moins).");
  const alias = await repositories.identifierAliases.findById(aliasId);
  if (!alias) throw new NotFoundError("Code externe", aliasId);
  const retired = await repositories.identifierAliases.retire(aliasId, new Date().toISOString(), reason.trim());
  if (!retired) throw new ConflictError("Ce code est déjà retiré.");
  await recordAudit({ actorId: session.userId, entityType: "identifier_alias", entityId: alias.id, field: "validTo", oldValue: null, newValue: retired.validTo, reason: reason.trim(), relatedLotId: null, relatedEventId: null });
  return retired;
}

export async function listIdentifierAliases(bvuId: string): Promise<IdentifierAlias[]> {
  return repositories.identifierAliases.listByBvuId(normalizeBvuId(bvuId));
}

export function isBvuObjectType(value: string): value is BvuObjectType {
  return value in BVU_KIND;
}

export function isTraceableType(value: string): boolean {
  return isEntityType(value) || value === "SUBJECT" || value === "TABLE_EGG_LOT";
}

/**
 * Gives every traced object recorded before identifiers existed its BIOVOLAILLES identifier.
 * Idempotent: objects that already have one keep it. Run once after the migration, and by the seed.
 */
export async function backfillBvuIds(): Promise<number> {
  const sources: [BvuObjectType, () => Promise<{ id: string }[]>][] = [
    ["LOT", () => repositories.lots.list()],
    ["PARENT_FLOCK", () => repositories.parentFlocks.list()],
    ["EGG_LOT", () => repositories.eggLots.list()],
    ["HATCH_CYCLE", () => repositories.hatchCycles.list()],
    ["CHICK_LOT", () => repositories.chickLots.list()],
    ["COLLECTION", () => repositories.collections.list()],
    ["SLAUGHTER_BATCH", () => repositories.slaughterBatches.list()],
    ["TRANSFORMATION_BATCH", () => repositories.transformationBatches.list()],
    ["PRODUCT", () => repositories.products.list()],
    ["SHIPMENT", () => repositories.shipments.list()],
    ["TABLE_EGG_LOT", () => repositories.tableEggLots.list()],
    ["TRANSFER", () => repositories.transfers.list()],
  ];
  let assigned = 0;
  for (const [type, list] of sources) {
    const rows = await list();
    const existing = new Set((await repositories.bvuIds.listByObjects(type, rows.map((r) => r.id))).map((r) => r.objectId));
    for (const row of rows) {
      if (existing.has(row.id)) continue;
      await assignBvuId(type, row.id);
      assigned += 1;
    }
  }
  return assigned;
}
