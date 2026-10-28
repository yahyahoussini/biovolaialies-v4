import { and, eq } from "drizzle-orm";
import type { SanitaryObservationRepository } from "../../domain/sanitary/repositories";
import type { NewSanitaryObservation, SanitaryObservation } from "../../domain/sanitary/types";
import type { ValidationStatus } from "../../domain/shared/enums";
import { db } from "../db/client";
import { sanitaryObservations } from "../db/schema";

export class DrizzleSanitaryObservationRepository implements SanitaryObservationRepository {
  async findById(id: string): Promise<SanitaryObservation | null> {
    const row = await db.query.sanitaryObservations.findFirst({ where: eq(sanitaryObservations.id, id) });
    return row ?? null;
  }

  async listByLot(lotId: string): Promise<SanitaryObservation[]> {
    return db.query.sanitaryObservations.findMany({
      where: eq(sanitaryObservations.lotId, lotId),
      orderBy: (t, { desc }) => desc(t.observedAt),
    });
  }

  async listPending(): Promise<SanitaryObservation[]> {
    return db.query.sanitaryObservations.findMany({
      where: eq(sanitaryObservations.validationStatus, "EN_ATTENTE"),
      orderBy: (t, { asc }) => asc(t.observedAt),
    });
  }

  async create(input: NewSanitaryObservation): Promise<SanitaryObservation> {
    const [row] = await db.insert(sanitaryObservations).values(input).returning();
    return row;
  }

  async review(id: string, validatedBy: string, status: Exclude<ValidationStatus, "EN_ATTENTE">): Promise<SanitaryObservation | null> {
    const [row] = await db
      .update(sanitaryObservations)
      .set({ validatedBy, validationStatus: status })
      .where(and(eq(sanitaryObservations.id, id), eq(sanitaryObservations.validationStatus, "EN_ATTENTE")))
      .returning();
    return row ?? null;
  }
}
