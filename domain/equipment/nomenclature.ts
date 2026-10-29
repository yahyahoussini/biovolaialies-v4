/**
 * The purchasing nomenclature of document 2 (ch. 09–11): 106 articles in sixteen families, each to
 * be described by the fifteen-field sheet of ch. 10 before it can be bought. "Une liste
 * d'équipements devient une nomenclature d'achat le jour où chaque ligne est achetable telle
 * quelle, sans qu'un fournisseur ait à poser une question." The budget is computed from the
 * articles, never typed: a quantity recalculated after the site survey moves it at once.
 * Pure: no I/O.
 */

export const PRICE_CONFIDENCE = ["haute", "moyenne", "faible"] as const;
export type PriceConfidence = (typeof PRICE_CONFIDENCE)[number];
export const PRICE_CONFIDENCE_LABEL: Record<PriceConfidence, string> = {
  haute: "Haute — article de catalogue standard, prix stable",
  moyenne: "Moyenne — des variantes de qualité changent le prix",
  faible: "Faible — dépend du modèle retenu, à consolider en priorité",
};

export const ORIGIN = ["Chine", "Maroc", "UE"] as const;
export type Origin = (typeof ORIGIN)[number];
export const ORIGIN_LABEL: Record<Origin, string> = {
  Chine: "Chine — importé",
  Maroc: "Maroc — acheté sur place",
  UE: "Union européenne — importé",
};

/** Ch. 09: the sixteen families. The four absent from the original budget cover the gravest risks. */
export const NOMENCLATURE_FAMILIES: Record<string, { name: string; purpose: string; absentFromOriginalBudget: boolean }> = {
  A: { name: "Ambiance intérieure", purpose: "Piloter et prouver le climat réellement vécu par les oiseaux", absentFromOriginalBudget: false },
  B: { name: "Extérieur et parcours", purpose: "Distinguer une dérive due au climat d'une dérive due à la conduite", absentFromOriginalBudget: false },
  C: { name: "Eau", purpose: "Détecter une fuite, un arrêt de boisson, une maladie qui commence", absentFromOriginalBudget: false },
  D: { name: "Aliment", purpose: "Connaître la consommation réelle et le stock sans monter sur le silo", absentFromOriginalBudget: false },
  E: { name: "Pesée des oiseaux", purpose: "Suivre la croissance sans manipuler, et dater la sortie", absentFromOriginalBudget: false },
  F: { name: "Vidéo et thermique", purpose: "Voir la répartition des animaux et détecter les zones froides", absentFromOriginalBudget: false },
  G: { name: "Identification", purpose: "Rattacher un animal, un plateau ou un lot à une identité durable", absentFromOriginalBudget: false },
  H: { name: "Œufs et couvoir", purpose: "Instrumenter le maillon le plus fragile et le plus mal documenté", absentFromOriginalBudget: true },
  I: { name: "Automatisme", purpose: "Transformer une mesure en action, et une action en enregistrement", absentFromOriginalBudget: false },
  J: { name: "Réseau et edge", purpose: "Continuer à fonctionner et à enregistrer quand la liaison tombe", absentFromOriginalBudget: true },
  K: { name: "Énergie de secours", purpose: "Empêcher qu'une coupure détruise une couvée ou un bâtiment plein", absentFromOriginalBudget: true },
  L: { name: "Alarme autonome", purpose: "Alerter même si le système principal est éteint", absentFromOriginalBudget: true },
  M: { name: "Câblage", purpose: "Relier proprement, de façon démontable et durable", absentFromOriginalBudget: false },
  N: { name: "Métrologie", purpose: "Pouvoir affirmer qu'un capteur dit vrai, avec une preuve écrite", absentFromOriginalBudget: false },
  O: { name: "Accès", purpose: "Savoir qui est entré et quand — base de la biosécurité", absentFromOriginalBudget: false },
  P: { name: "Connectique", purpose: "Ce qui fait tenir l'ensemble, et qu'aucun budget initial ne contient", absentFromOriginalBudget: false },
};

export const REFERENCE_CASE = "deux bâtiments, un site, un couvoir, une coopérative";

export interface NomenclatureArticle {
  id: string;
  /** 01 — stable internal identifier, survives a change of supplier. */
  ref: string;
  family: string;
  /** 02 */
  designation: string;
  /** 03 — brand and model, or "équivalent" with the minimum characteristics. */
  manufacturer: string | null;
  /** 04 — the quantity at the reference case, and the formula it comes from. */
  quantity: number;
  quantityFormula: string | null;
  /** 05 */
  location: string | null;
  /** 06 — the decision the equipment allows. */
  function: string | null;
  /** 07 — range, accuracy, protection, power. */
  specifications: string | null;
  /** 08 — the exact protocol. */
  communication: string | null;
  /** 09 */
  power: string | null;
  /** 10 */
  connectors: string | null;
  /** 11 — nature, section, shielding, length, route. */
  cables: string | null;
  /** 12 — a band, a date, a confidence level: never a bare figure. Unit price, ex-supplier, MAD. */
  priceLowMad: number;
  priceHighMad: number;
  priceConfidence: PriceConfidence;
  priceDate: string | null;
  /** 13 — who installs, with what, in how long, what must be cut. */
  installation: string | null;
  /** 14 */
  spares: string | null;
  /** 15 */
  maintenance: string | null;
  origin: Origin;
  sortOrder: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type SheetFieldKey =
  | "ref"
  | "designation"
  | "manufacturer"
  | "quantity"
  | "location"
  | "function"
  | "specifications"
  | "communication"
  | "power"
  | "connectors"
  | "cables"
  | "price"
  | "installation"
  | "spares"
  | "maintenance";

/** Ch. 10: the fifteen fields, and why each exists. Fields 05, 10, 11 and 13 are the ones everyone forgets. */
export const SHEET_FIELDS: { no: string; key: SheetFieldKey; label: string; why: string; forgotten: boolean }[] = [
  { no: "01", key: "ref", label: "Référence", why: "Identifiant interne stable. Il survit au changement de fournisseur.", forgotten: false },
  { no: "02", key: "designation", label: "Équipement", why: "Désignation métier, comprise par l'éleveur comme par l'installateur.", forgotten: false },
  { no: "03", key: "manufacturer", label: "Fabricant / type", why: "Marque et modèle, ou « équivalent » avec les caractéristiques minimales.", forgotten: false },
  { no: "04", key: "quantity", label: "Quantité", why: "Une formule, pas un nombre. Le nombre se recalcule après relevé.", forgotten: false },
  { no: "05", key: "location", label: "Emplacement", why: "Sans emplacement, pas de longueur de câble.", forgotten: true },
  { no: "06", key: "function", label: "Fonction", why: "La décision que l'équipement permet. Sans décision : à supprimer.", forgotten: false },
  { no: "07", key: "specifications", label: "Spécifications", why: "Étendue, précision, protection, alimentation.", forgotten: false },
  { no: "08", key: "communication", label: "Communication", why: "Le protocole exact, pas « numérique ».", forgotten: false },
  { no: "09", key: "power", label: "Alimentation", why: "Un capteur 24 V sans source 24 V proche est un chantier caché.", forgotten: false },
  { no: "10", key: "connectors", label: "Connecteurs", why: "Cause première des pannes d'humidité.", forgotten: true },
  { no: "11", key: "cables", label: "Câbles", why: "Nature, section, blindage, longueur, chemin emprunté.", forgotten: true },
  { no: "12", key: "price", label: "Prix", why: "Une bande, une date, un niveau de confiance. Jamais un chiffre nu.", forgotten: false },
  { no: "13", key: "installation", label: "Installation", why: "Qui pose, avec quoi, en combien de temps, ce qu'il faut couper.", forgotten: true },
  { no: "14", key: "spares", label: "Pièces de rechange", why: "Un capteur non remplaçable sous 48 h arrête une décision.", forgotten: false },
  { no: "15", key: "maintenance", label: "Maintenance", why: "Un capteur non entretenu ment sans prévenir.", forgotten: false },
];

const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Which of the fifteen fields are complete. A quantity needs its formula; a price needs its date. */
export function sheetStatus(a: NomenclatureArticle): Record<SheetFieldKey, boolean> {
  return {
    ref: filled(a.ref),
    designation: filled(a.designation),
    manufacturer: filled(a.manufacturer),
    quantity: a.quantity >= 0 && filled(a.quantityFormula),
    location: filled(a.location),
    function: filled(a.function),
    specifications: filled(a.specifications),
    communication: filled(a.communication),
    power: filled(a.power),
    connectors: filled(a.connectors),
    cables: filled(a.cables),
    price: a.priceHighMad >= a.priceLowMad && a.priceLowMad >= 0 && filled(a.priceDate),
    installation: filled(a.installation),
    spares: filled(a.spares),
    maintenance: filled(a.maintenance),
  };
}

export function filledCount(a: NomenclatureArticle): number {
  return Object.values(sheetStatus(a)).filter(Boolean).length;
}

/** Purchasable as it stands: all fifteen fields complete. */
export const isPurchasable = (a: NomenclatureArticle) => filledCount(a) === SHEET_FIELDS.length;

export interface BudgetBand {
  articles: number;
  units: number;
  lowMad: number;
  highMad: number;
}

const band = (articles: NomenclatureArticle[]): BudgetBand => ({
  articles: articles.length,
  units: articles.reduce((n, a) => n + a.quantity, 0),
  lowMad: articles.reduce((n, a) => n + a.quantity * a.priceLowMad, 0),
  highMad: articles.reduce((n, a) => n + a.quantity * a.priceHighMad, 0),
});

/**
 * Ch. 11 as printed: the three blocks and the total. Kept to be compared with the budget computed
 * from the article table — the two do not agree for the Moroccan and European blocks, and the
 * difference is shown rather than settled here.
 */
export const DOCUMENT_BUDGET: Record<Origin | "total", { articles: number; lowMad: number; highMad: number }> = {
  Chine: { articles: 90, lowMad: 105_000, highMad: 316_000 },
  Maroc: { articles: 10, lowMad: 103_000, highMad: 254_000 },
  UE: { articles: 6, lowMad: 25_000, highMad: 83_000 },
  total: { articles: 106, lowMad: 233_000, highMad: 653_000 },
};

/** Ch. 11 rounds to the thousand: a computed band less than a thousand dirhams from the printed one agrees with it. */
const ROUNDING_MAD = 1_000;

export interface BudgetLine extends BudgetBand {
  origin: Origin | "total";
  document: { articles: number; lowMad: number; highMad: number };
  agrees: boolean;
}

export function budget(articles: NomenclatureArticle[]): BudgetLine[] {
  const line = (origin: Origin | "total", list: NomenclatureArticle[]): BudgetLine => {
    const computed = band(list);
    const document = DOCUMENT_BUDGET[origin];
    const agrees = computed.articles === document.articles && Math.abs(computed.lowMad - document.lowMad) < ROUNDING_MAD && Math.abs(computed.highMad - document.highMad) < ROUNDING_MAD;
    return { origin, ...computed, document, agrees };
  };
  return [...ORIGIN.map((o) => line(o, articles.filter((a) => a.origin === o))), line("total", articles)];
}

export function familyBands(articles: NomenclatureArticle[]): (BudgetBand & { family: string; purchasable: number })[] {
  return Object.keys(NOMENCLATURE_FAMILIES).map((family) => {
    const list = articles.filter((a) => a.family === family);
    return { family, ...band(list), purchasable: list.filter(isPurchasable).length };
  });
}

/** Ch. 10: "connectique et câblage pèsent couramment 15 à 25 % du coût matériel". */
export const CABLING_SHARE_RANGE: [number, number] = [0.15, 0.25];
export const CABLING_FAMILIES = ["M", "P"];

export function cablingShare(articles: NomenclatureArticle[]): { low: number; high: number; withinRange: boolean } {
  const all = band(articles);
  const cabling = band(articles.filter((a) => CABLING_FAMILIES.includes(a.family)));
  const low = all.lowMad ? cabling.lowMad / all.lowMad : 0;
  const high = all.highMad ? cabling.highMad / all.highMad : 0;
  return { low, high, withinRange: low >= CABLING_SHARE_RANGE[0] && high <= CABLING_SHARE_RANGE[1] };
}

/** How many articles have each field complete: where the nomenclature is not yet purchasable. */
export function fieldCoverage(articles: NomenclatureArticle[]): Record<SheetFieldKey, number> {
  const out = Object.fromEntries(SHEET_FIELDS.map((f) => [f.key, 0])) as Record<SheetFieldKey, number>;
  for (const a of articles) {
    const status = sheetStatus(a);
    for (const f of SHEET_FIELDS) if (status[f.key]) out[f.key]++;
  }
  return out;
}
