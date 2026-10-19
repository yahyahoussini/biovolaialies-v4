import type { SensorType, ZoneKind } from "../shared/enums";

/**
 * The sensor catalogue of client document 2 ("Le matériel", chapter 2): where each sensor is
 * placed, the classic installation error, how often it is read, and the decision it feeds.
 * "Un capteur qui n'alimente aucune décision est à retirer du projet" — so every entry names
 * its decision rule, or says plainly that it is context only.
 *
 * `plausibleRange` is NOT from the client documents: it is the physical range outside which a
 * value can only be a fault (wiring, cell, unit). It is a working assumption to replace with
 * the range of the model actually bought (fiche à quinze champs).
 */

export const DECISION_RULE = [
  "BANDE_APPRISE",
  "DERIVE_ENTRE_ZONES",
  "CO2_VENTILATION",
  "NH3_EXPOSITION",
  "H2S_PRESENCE",
  "DEPRESSION_COMMANDE",
  "LUMIERE_PROGRAMME",
  "PARCOURS_DISPONIBLE",
  "EAU_PROFIL",
  "EAU_DESEQUILIBRE_LIGNES",
  "CUVE_AUTONOMIE",
  "SILO_STOCK",
  "VIS_SANS_ROTATION",
  "PESEE_HOMOGENEITE",
  "COUVOIR_POSITIONS",
  "SALLE_OEUFS_ECART",
  "ACCES_HORS_PLAGE",
  "CAPTEUR_SILENCIEUX",
] as const;
export type DecisionRule = (typeof DECISION_RULE)[number];

export interface ChannelSpec {
  type: SensorType;
  unit: string;
  plausibleRange: [number, number];
}

export interface SensorSpec {
  ref: string;
  label: string;
  zoneKind: ZoneKind;
  /** "Où exactement" — the placement rule, verbatim in substance. */
  placement: string;
  /** "L'erreur classique" — what makes this sensor useless if installed wrong. */
  classicError: string;
  channels: ChannelSpec[];
  /** Seconds between two readings at the source; null for event-driven or protocol-driven devices. */
  acquisitionSeconds: number | null;
  /** Seconds between two uplinks from the gateway; null when not periodic. */
  reportSeconds: number | null;
  frequency: string;
  /** "La décision déclenchée", as the client wrote it. */
  decision: string;
  rules: DecisionRule[];
  /** What the platform stores: sampled values, discrete events, or nothing but a reference to local video. */
  kind: "MESURE" | "EVENEMENT" | "VIDEO";
}

const T: ChannelSpec = { type: "TEMPERATURE", unit: "C", plausibleRange: [-20, 60] };
const RH: ChannelSpec = { type: "HUMIDITE", unit: "%", plausibleRange: [0, 100] };

export const SENSOR_CATALOG: SensorSpec[] = [
  {
    ref: "A01",
    label: "Capteur température + humidité",
    zoneKind: "ELEVAGE",
    placement:
      "Une unité par zone, sur l'axe médian, à 8,5 m, 25 m et 41,5 m du pignon d'entrée ; au dos des oiseaux : 0,30 m au démarrage puis 0,60–0,80 m.",
    classicError: "Fixation sous charpente : écart de 3 à 5 °C avec l'ambiance réellement subie en ventilation tunnel.",
    channels: [T, RH],
    acquisitionSeconds: 60,
    reportSeconds: 120,
    frequency: "Toutes les minutes en régime, remontée toutes les 2 minutes.",
    decision:
      "Écart à la bande de référence apprise par âge et par saison, et alerte de dérive entre zones au-delà du seuil configuré.",
    rules: ["BANDE_APPRISE", "DERIVE_ENTRE_ZONES"],
    kind: "MESURE",
  },
  {
    ref: "A02",
    label: "Capteur CO₂ NDIR",
    zoneKind: "ELEVAGE",
    placement: "Deux unités par bâtiment, à 12 m et 38 m du pignon, sur l'axe médian, à la hauteur des capteurs T/RH.",
    classicError: "Dans le flux direct d'une entrée d'air : il lit l'air neuf et rassure à tort.",
    channels: [{ type: "CO2", unit: "PPM", plausibleRange: [300, 10000] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Toutes les 2 minutes.",
    decision:
      "CO₂ élevé + ventilateurs à l'arrêt : panne technique ; CO₂ élevé + ventilateurs à 100 % : sous-dimensionnement.",
    rules: ["BANDE_APPRISE", "CO2_VENTILATION"],
    kind: "MESURE",
  },
  {
    ref: "A03",
    label: "Capteur ammoniac NH₃",
    zoneKind: "ELEVAGE",
    placement:
      "Deux unités à 12 m et 38 m, côté paroi vers la litière, à au moins 2 m de toute ligne d'abreuvement, 0,30 m au-dessus de la litière.",
    classicError: "Sous une ligne d'abreuvement : l'humidité fausse la cellule et raccourcit sa vie.",
    channels: [{ type: "NH3", unit: "PPM", plausibleRange: [0, 100] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Toutes les 2 minutes.",
    decision: "Alerte de seuil et surtout durée cumulée d'exposition au-dessus du seuil : c'est l'exposition qui compte.",
    rules: ["NH3_EXPOSITION"],
    kind: "MESURE",
  },
  {
    ref: "A04",
    label: "Capteur hydrogène sulfuré H₂S",
    zoneKind: "ELEVAGE",
    placement: "Une unité au centre (25 m), côté litière, à la hauteur des capteurs NH₃.",
    classicError: "Sur un cycle court ou une litière renouvelée à chaque bande : il ne mesurera jamais rien.",
    channels: [{ type: "H2S", unit: "PPM", plausibleRange: [0, 50] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Toutes les 2 minutes.",
    decision: "Alerte de présence : toute valeur significative déclenche une inspection de la litière, pas un réglage de ventilation.",
    rules: ["H2S_PRESENCE"],
    kind: "MESURE",
  },
  {
    ref: "A05",
    label: "Transmetteur de pression différentielle",
    zoneKind: "ELEVAGE",
    placement:
      "Prise intérieure au centre à 1,60 m hors flux ; prise extérieure sur la façade abritée du vent dominant, vers le bas, sous capuchon.",
    classicError: "Prise extérieure exposée au vent : fausses alarmes qui discréditent le système.",
    channels: [{ type: "PRESSION_DIFFERENTIELLE", unit: "PA", plausibleRange: [-150, 150] }],
    acquisitionSeconds: 30,
    reportSeconds: 120,
    frequency: "Toutes les 30 secondes en régime, remontée toutes les 2 minutes.",
    decision:
      "Croisement avec la position des volets et le nombre de ventilateurs : une dépression qui ne suit pas la commande signale un volet bloqué, un filtre encrassé ou une porte ouverte.",
    rules: ["DEPRESSION_COMMANDE"],
    kind: "MESURE",
  },
  {
    ref: "A06",
    label: "Capteur de luminosité",
    zoneKind: "ELEVAGE",
    placement: "Deux unités à 12 m et 38 m, zone mangeoires/abreuvoirs, à 1,00 m (hauteur d'œil des oiseaux).",
    classicError: "Sous une lampe : il lit le luminaire, pas l'éclairement reçu au sol.",
    channels: [{ type: "LUMIERE", unit: "LUX", plausibleRange: [0, 100000] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Toutes les 2 minutes.",
    decision: "Comparaison programme théorique / éclairement mesuré : écart d'intensité ou décalage d'allumage et d'extinction.",
    rules: ["LUMIERE_PROGRAMME"],
    kind: "MESURE",
  },
  {
    ref: "B01",
    label: "Station météo extérieure",
    zoneKind: "SITE",
    placement: "Une par site, à 2 m du sol, à 10 m au moins de tout bâtiment, hors ombre et hors flux des extracteurs.",
    classicError: "Sur un toit ou près d'un extracteur : elle mesure l'air rejeté par le bâtiment.",
    channels: [
      { type: "TEMPERATURE", unit: "C", plausibleRange: [-20, 60] },
      { type: "HUMIDITE", unit: "%", plausibleRange: [0, 100] },
      { type: "PLUIE", unit: "MM", plausibleRange: [0, 200] },
      { type: "VENT", unit: "M/S", plausibleRange: [0, 60] },
    ],
    acquisitionSeconds: 300,
    reportSeconds: 300,
    frequency: "Toutes les 5 minutes.",
    decision: "Variable de contexte de toutes les bandes : l'écart intérieur–extérieur est plus informatif que la valeur intérieure seule.",
    rules: [],
    kind: "MESURE",
  },
  {
    ref: "B02",
    label: "Sonde d'humidité et de température du sol",
    zoneKind: "PARCOURS",
    placement: "Deux unités dans le parcours, à des distances différentes du bâtiment (près de la sortie, zone éloignée).",
    classicError: "Les deux sondes au même endroit : on perd le gradient, qui est l'information cherchée.",
    channels: [
      { type: "HUMIDITE_SOL", unit: "%", plausibleRange: [0, 100] },
      { type: "TEMPERATURE_SOL", unit: "C", plausibleRange: [-10, 70] },
    ],
    acquisitionSeconds: 900,
    reportSeconds: 900,
    frequency: "Toutes les 15 minutes.",
    decision: "Indicateur de disponibilité du parcours, croisé avec la pluviométrie de la station météo.",
    rules: ["PARCOURS_DISPONIBLE"],
    kind: "MESURE",
  },
  {
    ref: "C01",
    label: "Débitmètre électromagnétique principal",
    zoneKind: "ELEVAGE",
    placement: "Sur l'arrivée d'eau du bâtiment, après filtre et régulateur, avant la dérivation vers les lignes.",
    classicError: "Après un coude ou un té : faux de plusieurs pour cent sans aucune alarme.",
    channels: [{ type: "EAU", unit: "L", plausibleRange: [0, 5000] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Totalisation continue, remontée toutes les 2 minutes (volume de l'intervalle).",
    decision: "Écart au profil de consommation attendu, calculé sur l'historique du site. Une chute déclenche une investigation, jamais un diagnostic.",
    rules: ["EAU_PROFIL"],
    kind: "MESURE",
  },
  {
    ref: "C02",
    label: "Débitmètre à impulsions de ligne",
    zoneKind: "ELEVAGE",
    placement: "Un par ligne d'abreuvement, en tête de ligne après la dérivation.",
    classicError: "Se contenter du compteur principal : on sait qu'il y a un problème, pas de quel côté.",
    channels: [{ type: "DEBIT_EAU", unit: "L/MIN", plausibleRange: [0, 200] }],
    acquisitionSeconds: 60,
    reportSeconds: 120,
    frequency: "Comptage d'impulsions, agrégation à la minute.",
    decision: "Alerte de déséquilibre entre lignes au-delà d'un écart configuré, à consommation totale constante.",
    rules: ["EAU_DESEQUILIBRE_LIGNES"],
    kind: "MESURE",
  },
  {
    ref: "C03",
    label: "Capteur de pression d'eau",
    zoneKind: "ELEVAGE",
    placement: "En BOUT de ligne d'abreuvement, au point hydraulique le plus éloigné du régulateur (47,6 m au bâtiment de référence).",
    classicError: "À la pompe ou juste après le régulateur : la mesure devient inutile.",
    channels: [{ type: "PRESSION_EAU", unit: "BAR", plausibleRange: [0, 10] }],
    acquisitionSeconds: 120,
    reportSeconds: 120,
    frequency: "Toutes les 2 minutes.",
    decision:
      "Croisement avec le débit : débit et pression en baisse → pompe ou fuite ; débit en baisse et pression normale → accès à l'eau ou comportement.",
    // The cross-check is the diagnosis of the water-profile rule, not a second alert on the same drop.
    rules: ["EAU_PROFIL"],
    kind: "MESURE",
  },
  {
    ref: "C04",
    label: "Capteur de niveau à ultrasons",
    zoneKind: "SITE",
    placement: "Sur le couvercle du réservoir tampon, décalé de la paroi d'au moins un cinquième du diamètre, jamais à l'aplomb de l'arrivée.",
    classicError: "À l'aplomb du jet de remplissage ou trop près de la paroi : échos parasites.",
    channels: [{ type: "NIVEAU_CUVE", unit: "L", plausibleRange: [0, 100000] }],
    acquisitionSeconds: 300,
    reportSeconds: 300,
    frequency: "Toutes les 5 minutes.",
    decision: "Alerte de niveau bas avec temps restant avant rupture, calculé sur la consommation des dernières 24 heures.",
    rules: ["CUVE_AUTONOMIE"],
    kind: "MESURE",
  },
  {
    ref: "C05",
    label: "Sonde de température d'eau",
    zoneKind: "ELEVAGE",
    placement: "Sur la ligne d'abreuvement, en bout de parcours hydraulique, près du capteur de pression.",
    classicError: "Mesurer au réservoir en croyant mesurer l'eau bue.",
    channels: [{ type: "TEMPERATURE_EAU", unit: "C", plausibleRange: [0, 50] }],
    acquisitionSeconds: 300,
    reportSeconds: 300,
    frequency: "Toutes les 5 minutes.",
    decision: "Contexte obligatoire pour interpréter une baisse de consommation (une eau à 30 °C ne se lit pas comme une eau à 18 °C).",
    // Read by the water-profile rule as context; it raises nothing on its own.
    rules: [],
    kind: "MESURE",
  },
  {
    ref: "D01",
    label: "Cellules de charge de silo",
    zoneKind: "ELEVAGE",
    placement: "Quatre par silo, une sous chaque pied, platines anti-soulèvement ; silo désolidarisé du bâtiment.",
    classicError: "Silo haubané sur la charpente : une partie du poids part dans la structure, surtout par grand vent.",
    channels: [{ type: "MASSE_SILO", unit: "KG", plausibleRange: [0, 40000] }],
    acquisitionSeconds: 300,
    reportSeconds: 300,
    frequency: "Toutes les 5 minutes, avec filtrage anti-vent.",
    decision: "Consommation journalière, écart au profil, stock bas, et détection automatique des livraisons par saut de masse.",
    rules: ["SILO_STOCK"],
    kind: "MESURE",
  },
  {
    ref: "D04",
    label: "Détecteur de rotation de vis",
    zoneKind: "ELEVAGE",
    placement: "En bout de chaque ligne d'alimentation, sur l'arbre ou le pignon terminal.",
    classicError: "Se fier au contacteur moteur : il indique une commande, pas un mouvement.",
    channels: [{ type: "ROTATION_VIS", unit: "TR/MIN", plausibleRange: [0, 600] }],
    acquisitionSeconds: 60,
    reportSeconds: 120,
    frequency: "Comptage continu (cumul par minute).",
    decision: "Alerte immédiate si le moteur est commandé et qu'aucune rotation n'est détectée pendant le délai configuré.",
    rules: ["VIS_SANS_ROTATION"],
    kind: "MESURE",
  },
  {
    ref: "E01",
    label: "Balance automatique pour oiseaux",
    zoneKind: "ELEVAGE",
    placement: "Deux par bâtiment, tiers central, à 2 m au moins de toute paroi, mangeoire, abreuvoir ou porte.",
    classicError: "Contre un mur ou près d'une mangeoire : échantillon non représentatif.",
    channels: [{ type: "POIDS", unit: "KG", plausibleRange: [0.02, 8] }],
    acquisitionSeconds: null,
    reportSeconds: 120,
    frequency: "Chaque passage d'oiseau, agrégation horaire.",
    decision: "Poids moyen, distribution, homogénéité, écart à la bande apprise. Le mode et la dispersion valent plus que la moyenne.",
    rules: ["PESEE_HOMOGENEITE", "BANDE_APPRISE"],
    kind: "MESURE",
  },
  {
    ref: "E02",
    label: "Balance mobile de contrôle",
    zoneKind: "ELEVAGE",
    placement: "Non fixe ; utilisée en plusieurs points du bâtiment selon un protocole écrit.",
    classicError: "Peser toujours au même endroit et à la même heure : on reproduit le biais cherché.",
    channels: [{ type: "POIDS", unit: "KG", plausibleRange: [0.02, 8] }],
    acquisitionSeconds: null,
    reportSeconds: null,
    frequency: "Selon protocole : au minimum début, milieu et fin de cycle.",
    decision: "Correction du biais de la balance automatique et validation de l'homogénéité mesurée.",
    rules: [],
    kind: "MESURE",
  },
  {
    ref: "F02",
    label: "Caméra dôme intérieure",
    zoneKind: "ELEVAGE",
    placement: "Trois par bâtiment, sous plafond à 2,80 m, à 5 m, 25 m et 45 m, inclinées pour couvrir la largeur.",
    classicError: "Promettre comptage ou poids par vision dès la mise en service : non validé sur le terrain.",
    channels: [],
    acquisitionSeconds: null,
    reportSeconds: null,
    frequency: "Enregistrement continu en local, conservation 15 à 30 jours.",
    decision:
      "Aucune règle automatique en version 1. La vidéo reste locale ; seules remontent les images fixes déclenchées et les séquences courtes demandées, rattachées à l'anomalie.",
    rules: [],
    kind: "VIDEO",
  },
  {
    ref: "H06",
    label: "Sonde de couvoir indépendante",
    zoneKind: "INCUBATEUR",
    placement: "Trois par incubateur (haut, milieu, bas du chariot) plus une dans l'air de reprise, indépendantes de la machine.",
    classicError: "Lire seulement la valeur de la machine : on enregistre ce que l'opérateur voit déjà.",
    channels: [T],
    acquisitionSeconds: 60,
    reportSeconds: 120,
    frequency: "Toutes les minutes.",
    decision: "Écart entre positions, durée hors plage, corrélation ultérieure avec l'éclosion par position de chariot.",
    rules: ["COUVOIR_POSITIONS"],
    kind: "MESURE",
  },
  {
    ref: "H03",
    label: "Enregistreur autonome pour œufs",
    zoneKind: "SALLE_OEUFS",
    placement: "Sur un plateau d'œufs, au centre d'un chariot ; voyage avec les œufs du bâtiment de ponte à la mise en incubation.",
    classicError: "Dans la pièce plutôt que sur le plateau : on mesure l'air, pas l'œuf.",
    channels: [T],
    acquisitionSeconds: 300,
    reportSeconds: null,
    frequency: "Une mesure toutes les 5 minutes sur tout le parcours (déchargée à l'arrivée).",
    decision: "Profil thermique complet (ponte, refroidissement, stockage, transport, réception), corrélé ensuite au taux d'éclosion du lot.",
    rules: [],
    kind: "MESURE",
  },
  {
    ref: "H06b",
    label: "Sondes de salle d'œufs",
    zoneKind: "SALLE_OEUFS",
    placement: "Deux par salle : une près de la porte, une au point le plus éloigné et le plus froid.",
    classicError: "Une seule sonde au centre, qui ne voit aucun des deux problèmes réels.",
    channels: [T, RH],
    acquisitionSeconds: 300,
    reportSeconds: 300,
    frequency: "Toutes les 5 minutes.",
    decision: "Alerte sur dépassement de plage et sur écart entre les deux points (porte ouverte, air mal réparti).",
    rules: ["SALLE_OEUFS_ECART"],
    kind: "MESURE",
  },
  {
    ref: "L01",
    label: "Alarme autonome GSM",
    zoneKind: "ARMOIRE",
    placement: "En armoire sur alimentation séparée, propre batterie et SIM, entrées câblées en direct depuis les thermostats et contacts de défaut.",
    classicError: "Câbler l'alarme sur une sortie de l'automate : elle se tait quand l'automate tombe.",
    channels: [],
    acquisitionSeconds: null,
    reportSeconds: null,
    frequency: "Surveillance permanente, non échantillonnée.",
    decision:
      "Appel vocal en cascade puis SMS, sans le logiciel. Le logiciel n'est pas dans ce chemin : il journalise seulement ce que l'alarme lui rapporte. L'acquittement est physique.",
    rules: [],
    kind: "EVENEMENT",
  },
  {
    ref: "L03",
    label: "Thermostat de sécurité mécanique",
    zoneKind: "ELEVAGE",
    placement: "Deux par bâtiment, en position représentative, indépendants de tout capteur électronique.",
    classicError: "Croire que le capteur T/RH le rend inutile : l'un mesure, l'autre protège.",
    channels: [],
    acquisitionSeconds: null,
    reportSeconds: null,
    frequency: "Permanent, tout ou rien.",
    decision: "Déclenche directement l'alarme autonome, sans aucun traitement logiciel. Le logiciel ne fait que journaliser.",
    rules: [],
    kind: "EVENEMENT",
  },
  {
    ref: "O01",
    label: "Contrôle d'accès et détecteur d'ouverture",
    zoneKind: "SITE",
    placement: "Sur la porte de chaque bâtiment et sur l'accès au couvoir.",
    classicError: "Lecteur sans contact d'ouverture : on sait qui a badgé, pas si la porte est restée ouverte.",
    channels: [],
    acquisitionSeconds: null,
    reportSeconds: null,
    frequency: "Événementiel.",
    decision: "Journal des accès rattaché au bâtiment et au lot, et alerte d'ouverture hors plage horaire.",
    rules: ["ACCES_HORS_PLAGE"],
    kind: "EVENEMENT",
  },
];

/**
 * Not sensors of document 2 but values read from the climate controller (document 2, ch. 4:
 * "Modbus RTU", read-only — the regulation stays local and never depends on the server).
 * They exist only as context for A02, A05 and D04.
 */
export const CONTROLLER_CHANNELS: SensorSpec = {
  ref: "PLC",
  label: "Automate de régulation (lecture seule)",
  zoneKind: "ELEVAGE",
  placement: "Armoire du bâtiment ; lu par la passerelle, jamais commandé par le logiciel.",
  classicError: "Écrire dans l'automate depuis le serveur : la ventilation dépendrait alors du réseau.",
  channels: [
    { type: "VENTILATION", unit: "%", plausibleRange: [0, 100] },
    { type: "VOLETS", unit: "%", plausibleRange: [0, 100] },
    { type: "COMMANDE_VIS", unit: "ETAT", plausibleRange: [0, 1] },
    { type: "TEMPERATURE_MACHINE", unit: "C", plausibleRange: [-20, 60] },
  ],
  acquisitionSeconds: 60,
  reportSeconds: 120,
  frequency: "Lu toutes les minutes, remonté toutes les 2 minutes.",
  decision: "Contexte des croisements CO₂ × ventilation, dépression × volets, vis commandée × rotation, sonde indépendante × machine.",
  rules: [],
  kind: "MESURE",
};

const BY_REF = new Map([...SENSOR_CATALOG, CONTROLLER_CHANNELS].map((s) => [s.ref, s]));

export function sensorSpec(ref: string | null | undefined): SensorSpec | null {
  return ref ? (BY_REF.get(ref) ?? null) : null;
}

export function channelSpec(ref: string | null | undefined, type: SensorType): ChannelSpec | null {
  return sensorSpec(ref)?.channels.find((c) => c.type === type) ?? null;
}

/** Seconds between two readings a channel is expected to deliver, for availability; null = not periodic. */
export function expectedIntervalSeconds(ref: string | null | undefined): number | null {
  return sensorSpec(ref)?.acquisitionSeconds ?? null;
}
