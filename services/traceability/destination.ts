import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { Destination } from "../../domain/traceability/types";
import { DESTINATION_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import type { Session } from "../auth/session";

/** Destination (phase-7 brief §9) — a simple reference entity, no logistics modeling. */
export const createDestinationInputSchema = z.object({
  code: z.string().trim().min(3).max(50),
  name: z.string().trim().min(1).max(200),
  type: z.enum(DESTINATION_TYPE),
  city: z.string().trim().min(1).max(100),
});
export type CreateDestinationInput = z.infer<typeof createDestinationInputSchema>;

export async function createDestination(input: unknown, session: Session): Promise<Destination> {
  if (!can(session, "CREATE", "EVENTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour créer une destination.");
  }
  const parsed = createDestinationInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const existing = await repositories.destinations.findByCode(data.code);
  if (existing) throw new ConflictError(`Le code de destination "${data.code}" est déjà utilisé.`);

  return repositories.destinations.create({ code: data.code, name: data.name, type: data.type, city: data.city });
}

export async function listDestinations(): Promise<Destination[]> {
  return repositories.destinations.list();
}
