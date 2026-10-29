import { repositories } from "../../data/repositories";
import { A01_SHEET, NOMENCLATURE_REFERENCE } from "../../data/seed/reference/nomenclature";
import {
  budget,
  cablingShare,
  familyBands,
  fieldCoverage,
  filledCount,
  isPurchasable,
  PRICE_CONFIDENCE,
  sheetStatus,
  SHEET_FIELDS,
  type BudgetLine,
  type NomenclatureArticle,
  type SheetFieldKey,
} from "../../domain/equipment/nomenclature";
import { recipeFor, type CommissioningRecipe } from "../../domain/equipment/recipes";
import type { NomenclatureChanges } from "../../domain/equipment/types";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { sensorSpec } from "../../domain/telemetry/catalog";
import { parseInput, z } from "../../lib/zod";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

/**
 * Loads document 2's 106 articles. Idempotent by reference: an article already present is never
 * overwritten, so a sheet completed after the supplier consultations survives a reload. Fields 05
 * and 06 of the sensors start from their ch. 02 implantation sheet (where it goes, the decision it
 * feeds); A01 carries the full sheet ch. 10 gives as its example. Everything else is left empty:
 * the document does not say it, and an empty field is what tells the buyer what to ask.
 */
export async function seedNomenclature(): Promise<void> {
  const existing = new Set((await repositories.nomenclature.list()).map((a) => a.ref));
  const missing = NOMENCLATURE_REFERENCE.map(([ref, designation, quantity, priceLowMad, priceHighMad, priceConfidence, origin], sortOrder) => {
    const spec = sensorSpec(ref);
    const sheet = ref === "A01" ? A01_SHEET : null;
    return {
      ref,
      family: ref[0],
      designation,
      manufacturer: null,
      quantity,
      quantityFormula: sheet?.quantityFormula ?? null,
      location: sheet?.location ?? spec?.placement ?? null,
      function: sheet?.function ?? spec?.decision ?? null,
      specifications: sheet?.specifications ?? null,
      communication: sheet?.communication ?? null,
      power: sheet?.power ?? null,
      connectors: sheet?.connectors ?? null,
      cables: sheet?.cables ?? null,
      priceLowMad,
      priceHighMad,
      priceConfidence,
      priceDate: null,
      installation: sheet?.installation ?? null,
      spares: sheet?.spares ?? null,
      maintenance: sheet?.maintenance ?? null,
      origin,
      sortOrder,
    };
  }).filter((a) => !existing.has(a.ref));
  await repositories.nomenclature.createMany(missing);
}

export interface ArticleRow extends NomenclatureArticle {
  filled: number;
  purchasable: boolean;
}

export interface NomenclatureView {
  articles: ArticleRow[];
  budget: BudgetLine[];
  families: ReturnType<typeof familyBands>;
  cabling: ReturnType<typeof cablingShare>;
  coverage: Record<SheetFieldKey, number>;
  purchasable: number;
}

export async function getNomenclature(session: Session): Promise<NomenclatureView> {
  if (!can(session, "VIEW", "EQUIPMENT")) throw new AuthorizationError();
  const articles = await repositories.nomenclature.list();
  return {
    articles: articles.map((a) => ({ ...a, filled: filledCount(a), purchasable: isPurchasable(a) })),
    budget: budget(articles),
    families: familyBands(articles),
    cabling: cablingShare(articles),
    coverage: fieldCoverage(articles),
    purchasable: articles.filter(isPurchasable).length,
  };
}

export interface ArticleSheet {
  article: NomenclatureArticle;
  status: Record<SheetFieldKey, boolean>;
  /** The ch. 02 implantation sheet, when the article is one of the placed sensors. */
  implantation: { placement: string; classicError: string; frequency: string; decision: string } | null;
  recipe: CommissioningRecipe | null;
  history: { at: string; field: string | null; oldValue: string | null; newValue: string | null; reason: string | null; actor: string }[];
}

export async function getNomenclatureArticle(ref: string, session: Session): Promise<ArticleSheet> {
  if (!can(session, "VIEW", "EQUIPMENT")) throw new AuthorizationError();
  const article = await repositories.nomenclature.findByRef(ref);
  if (!article) throw new NotFoundError("Article", ref);
  const spec = sensorSpec(ref);
  const [entries, users] = await Promise.all([repositories.auditLog.listByEntity("nomenclature_article", article.id), repositories.users.list()]);
  return {
    article,
    status: sheetStatus(article),
    implantation: spec ? { placement: spec.placement, classicError: spec.classicError, frequency: spec.frequency, decision: spec.decision } : null,
    recipe: recipeFor(ref),
    history: entries.map((e) => ({ at: e.createdAt, field: e.field, oldValue: e.oldValue, newValue: e.newValue, reason: e.reason, actor: users.find((u) => u.id === e.actorId)?.fullName ?? "Système" })),
  };
}

const text = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((v) => (v ? v : null));

const updateSchema = z
  .object({
    ref: z.string().trim().min(1),
    manufacturer: text,
    quantity: z.number().nonnegative().max(100_000),
    quantityFormula: text,
    location: text,
    function: text,
    specifications: text,
    communication: text,
    power: text,
    connectors: text,
    cables: text,
    priceLowMad: z.number().nonnegative().max(10_000_000),
    priceHighMad: z.number().nonnegative().max(10_000_000),
    priceConfidence: z.enum(PRICE_CONFIDENCE),
    priceDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date de la bande de prix attendue (AAAA-MM-JJ).")
      .nullable(),
    installation: text,
    spares: text,
    maintenance: text,
    reason: z.string().trim().min(3, "Indiquez d'où vient la modification (relevé, consultation, essai).").max(500),
  })
  .refine((v) => v.priceHighMad >= v.priceLowMad, "Le haut de la bande de prix ne peut pas être inférieur au bas.");

const EDITABLE: (keyof NomenclatureChanges & keyof z.infer<typeof updateSchema>)[] = [
  "manufacturer",
  "quantity",
  "quantityFormula",
  "location",
  "function",
  "specifications",
  "communication",
  "power",
  "connectors",
  "cables",
  "priceLowMad",
  "priceHighMad",
  "priceConfidence",
  "priceDate",
  "installation",
  "spares",
  "maintenance",
];

const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(SHEET_FIELDS.map((f) => [f.key, `${f.no} ${f.label}`])),
  quantity: "04 Quantité",
  quantityFormula: "04 Formule de quantité",
  priceLowMad: "12 Prix bas",
  priceHighMad: "12 Prix haut",
  priceConfidence: "12 Confiance du prix",
  priceDate: "12 Date de la bande de prix",
};

/**
 * Completes or corrects an article's sheet — after the site survey, a supplier consultation or a
 * test. Company-wide reference, so a global-scope role only. Each changed field is audited with its
 * value before and after and where the change comes from.
 */
export async function updateNomenclatureArticle(input: unknown, session: Session): Promise<NomenclatureArticle> {
  if (!can(session, "EDIT", "EQUIPMENT") || !isGlobalScope(session)) {
    throw new AuthorizationError("La nomenclature est commune à tous les sites : modification réservée à un rôle à périmètre global.");
  }
  const data = parseInput(updateSchema, input);
  const article = await repositories.nomenclature.findByRef(data.ref);
  if (!article) throw new NotFoundError("Article", data.ref);
  const changed = EDITABLE.filter((k) => (article[k] ?? null) !== (data[k] ?? null));
  if (changed.length === 0) throw new ValidationError("Aucune modification : la fiche est identique.");
  const updated = await repositories.nomenclature.update(article.id, {
    ...Object.fromEntries(changed.map((k) => [k, data[k]])),
    updatedAt: new Date().toISOString(),
    updatedBy: session.userId,
  });
  for (const k of changed) {
    await recordAudit({
      actorId: session.userId,
      entityType: "nomenclature_article",
      entityId: article.id,
      field: FIELD_LABEL[k] ?? k,
      oldValue: article[k] === null ? null : String(article[k]),
      newValue: data[k] === null ? null : String(data[k]),
      reason: `${article.ref} · ${data.reason}`,
      relatedLotId: null,
      relatedEventId: null,
    });
  }
  return updated;
}
