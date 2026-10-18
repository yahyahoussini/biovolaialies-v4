import { err, ok, type Result } from "../shared/result";

/**
 * Hatchery material balances (client spec A06, test T31 "Bilan OAC"). Pure, so the same rule
 * guards the service, the integrity checks and the tests.
 */

/** Eggs still available in a lot once earlier cycles have drawn on it. */
export function eggsRemaining(lotQuantity: number, alreadyAllocated: number): number {
  return lotQuantity - alreadyAllocated;
}

export function validateEggAllocation(lotQuantity: number, alreadyAllocated: number, requested: number): Result<true> {
  if (!Number.isInteger(requested) || requested <= 0) return err("La quantité d'œufs chargée doit être un entier positif.");
  const remaining = eggsRemaining(lotQuantity, alreadyAllocated);
  if (requested > remaining) return err(`Seulement ${remaining} œufs restent disponibles dans ce lot (demandé : ${requested}).`);
  return ok(true);
}

/** At candling, the clears removed can't exceed what was set. */
export function validateCandling(eggsSet: number, clearsRemoved: number): Result<true> {
  if (!Number.isInteger(clearsRemoved) || clearsRemoved < 0) return err("Le nombre d'œufs clairs retirés doit être un entier positif ou nul.");
  if (clearsRemoved > eggsSet) return err("Plus d'œufs retirés au mirage que d'œufs mis en incubation.");
  return ok(true);
}

/** At hatch: every egg set is accounted for — clear, unhatched, or hatched. Culls come out of the hatched. */
export function validateHatchBalance(input: {
  eggsSet: number;
  clearsRemoved: number;
  unhatched: number;
  chicksHatched: number;
  culls: number;
}): Result<true> {
  const values = [input.clearsRemoved, input.unhatched, input.chicksHatched, input.culls];
  if (values.some((v) => !Number.isInteger(v) || v < 0)) return err("Les quantités d'éclosion doivent être des entiers positifs ou nuls.");
  const accounted = input.clearsRemoved + input.unhatched + input.chicksHatched;
  if (accounted !== input.eggsSet) {
    return err(`Bilan non soldé : ${input.eggsSet} œufs mis en incubation, ${accounted} comptés (clairs + non éclos + éclos).`);
  }
  if (input.culls > input.chicksHatched) return err("Plus de poussins écartés que de poussins éclos.");
  return ok(true);
}

/** Saleable chicks a cycle can still dispatch. */
export function chicksAvailable(chicksHatched: number, culls: number, alreadyDispatched: number): number {
  return chicksHatched - culls - alreadyDispatched;
}

/** Hatch rate on eggs set — the hatchery's headline KPI. */
export function hatchRate(eggsSet: number, chicksHatched: number): number | null {
  return eggsSet > 0 ? chicksHatched / eggsSet : null;
}
