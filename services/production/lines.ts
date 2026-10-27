import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { DEFAULT_LINES, planError, type ProductionLine } from "../../domain/production/lines";
import { EGG_TYPE, LINE_PURPOSE, LOT_PHASE } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

/** Seeds the lines of the handwritten flow. A line already present — possibly edited — is left as it is. */
export async function ensureDefaultLines(): Promise<void> {
  for (const line of DEFAULT_LINES) await repositories.productionLines.insertIfMissing(line);
}

export async function listProductionLines(): Promise<ProductionLine[]> {
  return repositories.productionLines.list();
}

export async function getProductionLine(code: string | null | undefined): Promise<ProductionLine | null> {
  return code ? repositories.productionLines.findByCode(code) : null;
}

export async function requireProductionLine(code: string): Promise<ProductionLine> {
  const line = await repositories.productionLines.findByCode(code);
  if (!line) throw new NotFoundError("Ligne de production", code);
  if (!line.active) throw new ValidationError(`La ligne ${line.label} est désactivée.`);
  return line;
}

const daysField = z.number().int().nonnegative().max(3650);

export const updateLineSchema = z.object({
  label: z.string().trim().min(3).max(120),
  purpose: z.enum(LINE_PURPOSE),
  parentLineCode: z.string().trim().max(40).nullable().optional(),
  eggType: z.enum(EGG_TYPE).nullable().optional(),
  phasePlan: z
    .array(z.object({ phase: z.enum(LOT_PHASE), endsBetween: z.tuple([daysField, daysField]).nullable() }))
    .min(1)
    .max(8),
  exitMinDays: daysField.nullable(),
  exitMaxDays: daysField.nullable(),
  exitLabel: z.string().trim().min(3).max(120),
  active: z.boolean(),
  reason: z.string().trim().min(10, "Indiquez pourquoi le plan change (10 caractères au moins)."),
});

/**
 * Changes a line's plan. Ages already recorded on phases keep the check they had: a plan change
 * applies to what is recorded from now on, and the before/after values are kept in the audit.
 */
export async function updateProductionLine(code: string, input: unknown, session: Session): Promise<ProductionLine> {
  if (!can(session, "EDIT", "SETTINGS")) throw new AuthorizationError("Seule l'administration modifie le plan d'une ligne.");
  const data = parseInput(updateLineSchema, input);
  const line = await repositories.productionLines.findByCode(code);
  if (!line) throw new NotFoundError("Ligne de production", code);
  if (data.phasePlan.some((s) => s.phase === "REFORME")) throw new ValidationError("La réforme est la sortie de la ligne, pas une phase du plan.");
  const error = planError(data.phasePlan, data.exitMinDays, data.exitMaxDays);
  if (error) throw new ValidationError(error);
  if (data.parentLineCode && !(await repositories.productionLines.findByCode(data.parentLineCode))) throw new NotFoundError("Ligne parente", data.parentLineCode);
  const updated = await repositories.productionLines.update(code, {
    label: data.label,
    purpose: data.purpose,
    parentLineCode: data.parentLineCode ?? null,
    eggType: data.eggType ?? null,
    phasePlan: data.phasePlan,
    exitMinDays: data.exitMinDays,
    exitMaxDays: data.exitMaxDays,
    exitLabel: data.exitLabel,
    active: data.active,
    updatedAt: new Date().toISOString(),
    updatedBy: session.userId,
  });
  const snapshot = (l: ProductionLine) => JSON.stringify({ label: l.label, purpose: l.purpose, phasePlan: l.phasePlan, exitMinDays: l.exitMinDays, exitMaxDays: l.exitMaxDays, active: l.active });
  await recordAudit({ actorId: session.userId, entityType: "production_line", entityId: line.id, field: "plan", oldValue: snapshot(line), newValue: snapshot(updated), reason: data.reason, relatedLotId: null, relatedEventId: null });
  return updated;
}
