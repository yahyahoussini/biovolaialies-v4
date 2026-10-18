import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { validateInitialPopulation } from "../../domain/production/population";
import { DATA_STATUS } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import type { Lot, NewLot } from "../../domain/production/types";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy, resolveLotHierarchy } from "../identity/scope-check";

export async function getLotOrThrow(lotId: string): Promise<Lot> {
  const lot = await repositories.lots.findById(lotId);
  if (!lot) throw new NotFoundError("Lot", lotId);
  return lot;
}

export const createLotInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Le numéro de lot doit contenir au moins 3 caractères.")
    .max(50),
  buildingId: z.string().min(1, "Le bâtiment est requis."),
  species: z.string().trim().min(1, "L'espèce est requise.").max(100),
  breed: z.string().trim().min(1, "La souche est requise.").max(100),
  initialPopulation: z.number().int().positive("La population initiale doit être positive."),
  plannedStartAt: z.string().trim().min(1).optional().nullable(),
  dataStatus: z.enum(DATA_STATUS),
});
export type CreateLotInput = z.infer<typeof createLotInputSchema>;

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}

/**
 * Creates a Lot. Validates shape (Zod), building existence, caller scope, business-id
 * uniqueness, and population — in that order, each with a specific error. Records the
 * CREATION_LOT milestone event and an audit entry in the same call, per ARCHITECTURE.md §14.
 */
export async function createLot(input: unknown, session: Session): Promise<Lot> {
  if (!can(session, "CREATE", "LOTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour créer un lot.");
  }

  const parsed = createLotInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const data = parsed.data;

  const building = await repositories.buildings.findById(data.buildingId);
  if (!building) throw new NotFoundError("Building", data.buildingId);

  const path = await resolveBuildingHierarchy(data.buildingId);
  assertInScope(session, path);

  const existing = await repositories.lots.findByCode(data.code);
  if (existing) throw new ConflictError(`Le numéro de lot "${data.code}" est déjà utilisé.`);

  const populationCheck = validateInitialPopulation(data.initialPopulation);
  if (!populationCheck.ok) throw new ValidationError(populationCheck.error);

  const newLot: NewLot = {
    buildingId: data.buildingId,
    code: data.code,
    species: data.species,
    breed: data.breed,
    status: "PLANIFIE",
    initialPopulation: data.initialPopulation,
    currentPopulation: data.initialPopulation,
    plannedStartAt: data.plannedStartAt ?? null,
    startedAt: null,
    endedAt: null,
    dataStatus: data.dataStatus,
  };

  const lot = await repositories.lots.create(newLot);

  await repositories.lotEvents.create({
    lotId: lot.id,
    eventType: "CREATION_LOT",
    payload: { initialPopulation: lot.initialPopulation },
    occurredAt: lot.createdAt,
    actorId: session.userId,
    dataStatus: lot.dataStatus,
    sourceType: "MANUEL",
    sourceId: null,
    deviceId: null,
    measurementMethod: null,
    validationStatus: null,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "lot",
    entityId: lot.id,
    field: null,
    oldValue: null,
    newValue: lot.code,
    reason: "Création du lot",
    relatedLotId: lot.id,
    relatedEventId: null,
  });

  return lot;
}

export const updateLotInputSchema = z.object({
  species: z.string().trim().min(1).max(100).optional(),
  breed: z.string().trim().min(1).max(100).optional(),
  plannedStartAt: z.string().trim().min(1).optional().nullable(),
  dataStatus: z.enum(DATA_STATUS).optional(),
});
export type UpdateLotInput = z.infer<typeof updateLotInputSchema>;

/**
 * Edits mutable identity/planning fields only. Deliberately excludes businessId (stable
 * identity), buildingId (a relocation is a transfer, not an edit), status (only via
 * transitionLotStatus), and population (only via a validated event) — see ARCHITECTURE.md §15.
 */
export async function updateLot(lotId: string, input: unknown, session: Session): Promise<Lot> {
  if (!can(session, "EDIT", "LOTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour modifier ce lot.");
  }

  const lot = await getLotOrThrow(lotId);
  const path = await resolveLotHierarchy(lotId);
  assertInScope(session, path);

  const parsed = updateLotInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

  const updated = await repositories.lots.update(lotId, parsed.data);

  await recordAudit({
    actorId: session.userId,
    entityType: "lot",
    entityId: lotId,
    field: "edit",
    oldValue: JSON.stringify({ species: lot.species, breed: lot.breed, plannedStartAt: lot.plannedStartAt }),
    newValue: JSON.stringify(parsed.data),
    reason: "Modification des informations du lot",
    relatedLotId: lotId,
    relatedEventId: null,
  });

  return updated;
}
