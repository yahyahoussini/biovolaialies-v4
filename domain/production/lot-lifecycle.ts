import type { LotStatus } from "../shared/enums";
import { err, ok, type Result } from "../shared/result";

/**
 * Allowed status transitions for a Lot. This is the single source of truth for
 * lifecycle rules — services call canTransition() before writing a new status;
 * the UI never decides on its own whether a transition is legal.
 */
const ALLOWED_TRANSITIONS: Record<LotStatus, readonly LotStatus[]> = {
  PLANIFIE: ["CREE", "ARCHIVE"],
  CREE: ["ACTIF", "SUSPENDU", "ARCHIVE"],
  ACTIF: ["EN_TRANSFERT", "SUSPENDU", "BLOQUE", "ABATTU"],
  // Every bird left through transfers: the lot ends here, its birds live on in the lots that received them.
  EN_TRANSFERT: ["ACTIF", "SUSPENDU", "BLOQUE", "CLOTURE"],
  SUSPENDU: ["ACTIF", "BLOQUE", "ARCHIVE"],
  BLOQUE: ["LIBERE", "ARCHIVE"],
  LIBERE: ["ACTIF", "EN_TRANSFERT", "ABATTU"],
  ABATTU: ["TRANSFORME", "CLOTURE"],
  TRANSFORME: ["CLOTURE"],
  CLOTURE: ["ARCHIVE"],
  ARCHIVE: [],
};

export function canTransition(from: LotStatus, to: LotStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function validateTransition(from: LotStatus, to: LotStatus): Result<true, string> {
  if (from === to) return err(`Le lot est déjà au statut ${to}.`);
  if (!canTransition(from, to)) {
    return err(`Transition invalide : ${from} → ${to}.`);
  }
  return ok(true);
}
