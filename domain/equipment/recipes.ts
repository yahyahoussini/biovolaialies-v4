/**
 * The commissioning tests of document 2, annex A, verbatim: "le test qui prouve, à la mise en
 * service, qu'un capteur est correctement posé et correctement raccordé". Results are recorded per
 * building — the A01 test covers the three probes of a building, the H06 test the four probes of an
 * incubator — and no sensor counts as installed before its test is recorded with its date and the
 * name of the person who ran it.
 * Pure: no I/O.
 */

export interface CommissioningRecipe {
  /** The catalogue reference of the equipment tested (A01…O01). */
  code: string;
  equipment: string;
  test: string;
}

export const COMMISSIONING_RECIPES: CommissioningRecipe[] = [
  { code: "A01", equipment: "Capteur température + humidité", test: "Comparaison des trois capteurs avec un thermomètre étalon promené aux trois positions : écart maximal admis 0,5 °C après compensation." },
  { code: "A02", equipment: "Capteur CO₂ NDIR", test: "Test au gaz étalon ou, à défaut, contrôle croisé avec un appareil de référence à trois moments de la journée." },
  { code: "A03", equipment: "Capteur ammoniac NH₃", test: "Contrôle au tube réactif ou à l'appareil portable de référence, et enregistrement de la date de mise en service de la cellule — durée de vie 12 à 24 mois en ambiance avicole." },
  { code: "A04", equipment: "Capteur hydrogène sulfuré H₂S", test: "Vérification de la réponse au gaz étalon à la mise en service, puis contrôle annuel." },
  { code: "A05", equipment: "Transmetteur de pression différentielle", test: "Essai porte ouverte puis porte fermée : la variation doit être franche et reproductible. Vérification du zéro tubes débranchés." },
  { code: "A06", equipment: "Capteur de luminosité", test: "Mesure comparative au luxmètre portable en neuf points du bâtiment, pour établir la relation entre le point de mesure fixe et la moyenne réelle." },
  { code: "B01", equipment: "Station météo extérieure", test: "Comparaison sur une semaine avec la station publique la plus proche : les tendances doivent coïncider, les valeurs absolues peuvent différer." },
  { code: "B02", equipment: "Sonde d'humidité et de température du sol", test: "Contrôle de cohérence après une pluie mesurée : les deux sondes doivent réagir, avec un décalage entre elles." },
  { code: "C01", equipment: "Débitmètre électromagnétique principal", test: "Contrôle volumétrique : remplir un volume connu et comparer au comptage. Écart admis 2 %." },
  { code: "C02", equipment: "Débitmètre à impulsions de ligne", test: "Fermeture d'une ligne et vérification que la répartition mesurée bascule bien sur l'autre." },
  { code: "C03", equipment: "Capteur de pression d'eau", test: "Comparaison avec un manomètre étalon monté sur la même prise, à trois niveaux de débit." },
  { code: "C04", equipment: "Capteur de niveau à ultrasons", test: "Remplissage et vidange partiels avec relevé manuel à la jauge, pour valider la courbe hauteur-volume." },
  { code: "C05", equipment: "Sonde de température d'eau", test: "Comparaison avec un thermomètre étalon plongé dans un prélèvement en bout de ligne." },
  { code: "D01", equipment: "Cellules de charge de silo", test: "Essai avec masses étalons connues posées sur le silo, ou contrôle par pesée d'un camion de livraison. Écart admis 2 %." },
  { code: "D04", equipment: "Détecteur de rotation de vis", test: "Blocage volontaire de la vis à la mise en service : l'alerte doit remonter en moins d'une minute." },
  { code: "E01", equipment: "Balance automatique pour oiseaux", test: "Pesée manuelle d'un échantillon le même jour et comparaison des distributions, à répéter à trois âges différents du cycle." },
  { code: "E02", equipment: "Balance mobile de contrôle", test: "Vérification avec le jeu de masses étalons avant chaque campagne de pesée." },
  { code: "F02", equipment: "Caméra dôme intérieure", test: "Contrôle de la couverture réelle : aucune zone morte de plus de 5 m sur la longueur, et lisibilité en éclairage nocturne." },
  { code: "H06", equipment: "Sonde de couvoir indépendante", test: "Comparaison des quatre sondes entre elles à machine vide et stabilisée : dispersion admise 0,2 °C. Toute dispersion supérieure est un défaut de sonde, pas de machine." },
  { code: "H03", equipment: "Enregistreur autonome pour œufs", test: "Deux enregistreurs sur le même chariot, à des positions différentes, sur les trois premiers lots : l'écart entre eux donne la dispersion réelle du chariot." },
  { code: "H06b", equipment: "Sondes de salle d'œufs", test: "Ouverture prolongée de la porte à la recette : la sonde côté porte doit réagir nettement plus vite que celle du fond." },
  { code: "L01", equipment: "Alarme autonome GSM", test: "Essai de coupure générale du courant à la recette : l'appel doit partir en moins de deux minutes, sur batterie, sans intervention." },
  { code: "L03", equipment: "Thermostat de sécurité mécanique", test: "Essai de déclenchement par échauffement local à la recette, sur les deux seuils." },
  { code: "O01", equipment: "Contrôle d'accès et détecteur d'ouverture", test: "Test d'ouverture sans badge : l'événement doit remonter comme accès non identifié." },
];

export const RECEPTION_RULE = {
  rule: "Aucun capteur n'est réputé posé tant que sa recette n'a pas été exécutée et consignée, avec la date et le nom de la personne.",
  payment: "Le paiement du solde de l'installateur est conditionné à la consignation de l'ensemble des recettes.",
  why: "C'est la seule façon d'éviter le scénario classique : une installation « terminée » qui produit des données fausses pendant tout le premier cycle.",
};

export const recipeFor = (code: string) => COMMISSIONING_RECIPES.find((r) => r.code === code) ?? null;

export type CommissioningOutcome = "CONFORME" | "NON_CONFORME";

export interface CommissioningRecord {
  id: string;
  buildingId: string;
  code: string;
  result: CommissioningOutcome;
  /** When the test was run, and by whom — often the installer's technician, not a platform user. */
  performedAt: string;
  performedBy: string;
  measured: string | null;
  evidence: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface ReceptionStatus {
  applicable: number;
  conforming: number;
  nonConforming: string[];
  missing: string[];
  /** Every applicable test recorded and conforming: the installer's balance may be paid. */
  complete: boolean;
}

/** A building's reception: the latest record of each test that applies to its equipment decides. */
export function receptionStatus(applicableCodes: string[], latest: Map<string, CommissioningRecord>): ReceptionStatus {
  const nonConforming = applicableCodes.filter((c) => latest.get(c)?.result === "NON_CONFORME");
  const missing = applicableCodes.filter((c) => !latest.has(c));
  const conforming = applicableCodes.length - nonConforming.length - missing.length;
  return { applicable: applicableCodes.length, conforming, nonConforming, missing, complete: applicableCodes.length > 0 && conforming === applicableCodes.length };
}
