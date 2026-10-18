import { z } from "../../lib/zod";
import type { EventType } from "../shared/enums";

/**
 * Payload shape per lot event type. Kept intentionally small for this phase — only the
 * foundational event types from the phase-2 brief are modeled. Sanitary/IoT-sourced events
 * (VACCINATION, TRAITEMENT, OBSERVATION_SANITAIRE, ABATTAGE) get their own richer payloads
 * in the phases that actually build those modules.
 */
export const creationLotPayloadSchema = z.object({
  initialPopulation: z.number().int().positive(),
});

export const miseEnPlacePayloadSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const mortalitePayloadSchema = z.object({
  quantity: z.number().int().positive(),
  cause: z.string().max(200).optional(),
});

export const peseePayloadSchema = z.object({
  averageWeightKg: z.number().positive(),
  sampleSize: z.number().int().positive().optional(),
});

export const alimentationPayloadSchema = z.object({
  quantityKg: z.number().positive(),
  feedType: z.string().max(100).optional(),
});

export const transfertPayloadSchema = z.object({
  quantity: z.number().int().positive(),
  destination: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export const autrePayloadSchema = z.object({
  description: z.string().min(1).max(500),
});

const PAYLOAD_SCHEMAS = {
  CREATION_LOT: creationLotPayloadSchema,
  MISE_EN_PLACE: miseEnPlacePayloadSchema,
  MORTALITE: mortalitePayloadSchema,
  PESEE: peseePayloadSchema,
  ALIMENTATION: alimentationPayloadSchema,
  TRANSFERT: transfertPayloadSchema,
  AUTRE: autrePayloadSchema,
} satisfies Partial<Record<EventType, z.ZodType>>;

/** Event types this phase actually supports creating through the UI/service layer. */
export type SupportedEventType = keyof typeof PAYLOAD_SCHEMAS;

export function isSupportedEventType(eventType: EventType): eventType is SupportedEventType {
  return eventType in PAYLOAD_SCHEMAS;
}

export function validateEventPayload(eventType: SupportedEventType, payload: unknown) {
  return PAYLOAD_SCHEMAS[eventType].safeParse(payload);
}
