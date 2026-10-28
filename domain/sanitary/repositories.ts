import type { ValidationStatus } from "../shared/enums";
import type { NewSanitaryObservation, SanitaryObservation } from "./types";

/**
 * Field observations of a lot's health. The detail of what was seen lives on the matching
 * OBSERVATION_SANITAIRE lot event; this row carries the review: a technician or veterinarian
 * confirms or rejects it (validationStatus), and who did is kept.
 */
export interface SanitaryObservationRepository {
  findById(id: string): Promise<SanitaryObservation | null>;
  listByLot(lotId: string): Promise<SanitaryObservation[]>;
  create(input: NewSanitaryObservation): Promise<SanitaryObservation>;
  /** Compare-and-set on EN_ATTENTE: a review is decided once. */
  review(id: string, validatedBy: string, status: Exclude<ValidationStatus, "EN_ATTENTE">): Promise<SanitaryObservation | null>;
}
