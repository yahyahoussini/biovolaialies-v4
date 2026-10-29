import type { Session } from "../../../services/auth/session";
import { recordCommissioning } from "../../../services/equipment/commissioning";
import { repositories } from "../../repositories";

/**
 * Commissioning of the two instrumented buildings, recorded through the real service in the days
 * after their installation (2025-02-15). The beldi building's ammonia cell failed its first test and
 * passed once replaced; its weather station was never compared with the public station over a week,
 * so its reception is not pronounced and the installer's balance stays blocked. The hatchery is
 * fully received. Names and reports are demonstration data.
 */

type Run = [code: string, result: "CONFORME" | "NON_CONFORME", day: string, measured: string, notes?: string];

const INSTALLER = "Y. Amrani, technicien de l'installateur (démonstration)";

const BELDI: Run[] = [
  ["A01", "CONFORME", "2025-02-17", "Écart maximal 0,3 °C aux trois positions, après compensation"],
  ["A02", "CONFORME", "2025-02-17", "Contrôle croisé à 8 h, 13 h et 19 h : écart ≤ 60 ppm"],
  ["A03", "NON_CONFORME", "2025-02-17", "Tube réactif 10 ppm, cellule 16 ppm à 38 m", "Cellule défectueuse, renvoyée au fournisseur."],
  ["A04", "CONFORME", "2025-02-18", "Réponse franche au gaz étalon 10 ppm"],
  ["A05", "CONFORME", "2025-02-18", "Porte ouverte −2 Pa, fermée −18 Pa, reproductible ; zéro tubes débranchés 0,4 Pa"],
  ["A06", "CONFORME", "2025-02-18", "Relation point fixe / moyenne des neuf points : coefficient 0,92"],
  ["B02", "CONFORME", "2025-03-04", "Les deux sondes réagissent après 12 mm de pluie, décalage de 3 h"],
  ["C01", "CONFORME", "2025-02-19", "1 000 L comptés 1 012 L : écart 1,2 %"],
  ["C02", "CONFORME", "2025-02-19", "Ligne 1 fermée : la répartition bascule sur les lignes 2 à 4"],
  ["C03", "CONFORME", "2025-02-19", "Écart au manomètre étalon ≤ 0,05 bar aux trois débits"],
  ["C04", "CONFORME", "2025-02-20", "Courbe hauteur-volume validée sur 4 relevés à la jauge"],
  ["C05", "CONFORME", "2025-02-19", "Écart 0,2 °C au thermomètre étalon en bout de ligne"],
  ["D01", "CONFORME", "2025-02-21", "Camion de 6,02 t pesé 6,07 t : écart 0,8 %"],
  ["D04", "CONFORME", "2025-02-20", "Vis bloquée volontairement : alerte remontée en 40 s"],
  ["E01", "CONFORME", "2025-02-21", "Distributions balance / pesée manuelle superposées (1er âge sur 3)"],
  ["E02", "CONFORME", "2025-02-21", "Masses étalons 5, 10 et 20 kg : écart ≤ 10 g"],
  ["F02", "CONFORME", "2025-02-20", "Aucune zone morte de plus de 5 m ; image lisible en éclairage nocturne"],
  ["L01", "CONFORME", "2025-02-21", "Coupure générale : appel parti en 70 s sur batterie"],
  ["L03", "CONFORME", "2025-02-21", "Déclenchement aux deux seuils par échauffement local"],
  ["O01", "CONFORME", "2025-02-20", "Ouverture sans badge remontée comme accès non identifié"],
  ["A03", "CONFORME", "2025-02-24", "Cellule remplacée : tube réactif 10 ppm, cellule 11 ppm", "Mise en service de la cellule le 24/02/2025 (durée de vie 12 à 24 mois)."],
];

const HATCHERY: Run[] = [
  ["H06", "CONFORME", "2025-02-18", "Machines vides et stabilisées : dispersion 0,15 °C entre les quatre sondes"],
  ["H03", "CONFORME", "2025-03-10", "Deux enregistreurs sur le même chariot : écart 0,4 °C sur les trois premiers lots"],
  ["H06b", "CONFORME", "2025-02-18", "Porte ouverte 10 min : la sonde côté porte réagit en 2 min, celle du fond en 9 min"],
  ["L01", "CONFORME", "2025-02-19", "Coupure générale : appel parti en 55 s sur batterie"],
  ["O01", "CONFORME", "2025-02-19", "Ouverture sans badge remontée comme accès non identifié"],
];

export async function seedCommissioning(admin: Session): Promise<void> {
  const buildings = await repositories.buildings.list();
  for (const [code, runs] of [["BEL-01", BELDI], ["COUV-01", HATCHERY]] as const) {
    const building = buildings.find((b) => b.code === code);
    if (!building) continue;
    for (const [i, [recipe, result, day, measured, notes]] of runs.entries()) {
      await recordCommissioning(
        { buildingId: building.id, code: recipe, result, performedAt: day, performedBy: INSTALLER, measured, evidence: `PV-RECETTE-${code}-${recipe}-${day.replace(/-/g, "")} (démonstration)`, notes: notes ?? null },
        admin,
        // Recorded the evening of the test, in the order run, so the latest record of a test is its current result.
        new Date(Date.parse(`${day}T18:00:00.000Z`) + i * 60_000)
      );
    }
  }
}
