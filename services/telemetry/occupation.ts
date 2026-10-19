import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { findOverlap } from "../../domain/telemetry/occupation";
import type { Zone, ZoneOccupation } from "../../domain/telemetry/types";
import { ZONE_KIND } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy, resolveFarmHierarchy } from "../identity/scope-check";
import { reattributeReadings } from "./reattribute";

const isoDate = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide.");

export const createZoneSchema = z.object({
  farmId: z.string().min(1),
  buildingId: z.string().min(1).nullable().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(ZONE_KIND),
});

export async function createZone(input: unknown, session: Session): Promise<Zone> {
  if (!can(session, "EDIT", "BUILDINGS")) throw new AuthorizationError();
  const data = parseInput(createZoneSchema, input);
  assertInScope(session, data.buildingId ? await resolveBuildingHierarchy(data.buildingId) : await resolveFarmHierarchy(data.farmId));
  if (data.buildingId) {
    const building = await repositories.buildings.findById(data.buildingId);
    if (!building || building.farmId !== data.farmId) throw new ValidationError("Le bâtiment n'appartient pas à cette ferme.");
  }
  if ((await repositories.zones.listByFarm(data.farmId)).some((z) => z.code === data.code)) throw new ConflictError("Ce code de zone existe déjà sur la ferme.");
  const zone = await repositories.zones.create({ farmId: data.farmId, buildingId: data.buildingId ?? null, code: data.code, name: data.name, kind: data.kind });
  await recordAudit({ actorId: session.userId, entityType: "zone", entityId: zone.id, field: null, oldValue: null, newValue: `${zone.code} — ${zone.name}`, reason: "Création d'une zone", relatedLotId: null, relatedEventId: null });
  return zone;
}

export const startOccupationSchema = z.object({
  zoneId: z.string().min(1),
  lotId: z.string().min(1),
  startedAt: isoDate,
  endedAt: isoDate.nullable().optional(),
  headCount: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * Records that a lot occupies a zone from a date (and, for a past occupation, until a date).
 * One lot per zone at a time: two lots in one zone would make every reading there ambiguous,
 * so the overlap is refused. Readings already received for that period are re-attributed.
 */
export async function startOccupation(input: unknown, session: Session): Promise<ZoneOccupation> {
  if (!can(session, "EDIT", "LOTS")) throw new AuthorizationError();
  const data = parseInput(startOccupationSchema, input);
  const zone = await repositories.zones.findById(data.zoneId);
  if (!zone) throw new NotFoundError("Zone", data.zoneId);
  const lot = await repositories.lots.findById(data.lotId);
  if (!lot) throw new NotFoundError("Lot", data.lotId);
  assertInScope(session, await resolveBuildingHierarchy(lot.buildingId));
  const lotBuilding = await repositories.buildings.findById(lot.buildingId);
  if (!lotBuilding || lotBuilding.farmId !== zone.farmId) throw new ValidationError("Le lot et la zone ne sont pas sur la même ferme.");
  const startedAt = new Date(data.startedAt).toISOString();
  const endedAt = data.endedAt ? new Date(data.endedAt).toISOString() : null;
  if (endedAt && endedAt <= startedAt) throw new ValidationError("La fin d'occupation doit suivre son début.");
  if (Date.parse(startedAt) > Date.now() + 86_400_000) throw new ValidationError("Une occupation ne commence pas plus d'un jour dans le futur.");

  const existing = await repositories.zoneOccupations.listByZones([zone.id]);
  const overlap = findOverlap(existing, { zoneId: zone.id, lotId: lot.id, startedAt, endedAt });
  if (overlap) {
    const other = await repositories.lots.findById(overlap.lotId);
    throw new ConflictError(`La zone est déjà occupée par le lot ${other?.code ?? overlap.lotId} sur cette période.`);
  }
  const row = await repositories.zoneOccupations.create({
    zoneId: zone.id,
    lotId: lot.id,
    startedAt,
    endedAt,
    headCount: data.headCount ?? null,
    note: data.note ?? null,
    recordedBy: session.userId,
  });
  const moved = await reattributeReadings(zone.id, startedAt, endedAt);
  await recordAudit({
    actorId: session.userId,
    entityType: "zone_occupation",
    entityId: row.id,
    field: null,
    oldValue: null,
    newValue: `${lot.code} dans ${zone.code} du ${startedAt}${endedAt ? ` au ${endedAt}` : ""}`,
    reason: moved ? `Occupation enregistrée ; ${moved} mesure(s) déjà reçue(s) rattachée(s) au lot` : "Occupation enregistrée",
    relatedLotId: lot.id,
    relatedEventId: null,
  });
  return row;
}

export const endOccupationSchema = z.object({ occupationId: z.string().min(1), endedAt: isoDate });

export async function endOccupation(input: unknown, session: Session): Promise<ZoneOccupation> {
  if (!can(session, "EDIT", "LOTS")) throw new AuthorizationError();
  const data = parseInput(endOccupationSchema, input);
  const occupation = await repositories.zoneOccupations.findById(data.occupationId);
  if (!occupation) throw new NotFoundError("Occupation", data.occupationId);
  const lot = await repositories.lots.findById(occupation.lotId);
  if (lot) assertInScope(session, await resolveBuildingHierarchy(lot.buildingId));
  const endedAt = new Date(data.endedAt).toISOString();
  if (endedAt <= occupation.startedAt) throw new ValidationError("La fin d'occupation doit suivre son début.");
  const closed = await repositories.zoneOccupations.close(occupation.id, endedAt);
  if (!closed) throw new ConflictError("Cette occupation est déjà close.");
  const moved = await reattributeReadings(occupation.zoneId, endedAt, null);
  await recordAudit({
    actorId: session.userId,
    entityType: "zone_occupation",
    entityId: occupation.id,
    field: "endedAt",
    oldValue: null,
    newValue: endedAt,
    reason: moved ? `Fin d'occupation ; ${moved} mesure(s) postérieure(s) détachée(s) du lot` : "Fin d'occupation",
    relatedLotId: occupation.lotId,
    relatedEventId: null,
  });
  return closed;
}

export async function listOccupations(session: Session) {
  if (!can(session, "VIEW", "LOTS")) throw new AuthorizationError();
  return repositories.zoneOccupations.list();
}
