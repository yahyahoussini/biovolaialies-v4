import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { EQUIPMENT_STATUS_LABEL, type CommissioningTest, type EquipmentItem } from "../../domain/equipment/types";
import { COMMISSIONING_RESULT } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { csvField } from "../leads/leads";
import equipmentReference from "../../data/seed/reference/equipment.json";
import { COMMISSIONING_REFERENCE } from "../../data/seed/reference/commissioning";

/**
 * The register and the commissioning checklist are company-wide, not tied to one farm, so a
 * farm-scoped role may read them but only a global-scope role may change them.
 */
function assertCanEditRegister(session: Session): void {
  if (!can(session, "EDIT", "EQUIPMENT") || !isGlobalScope(session)) {
    throw new AuthorizationError("Le registre des équipements est commun à tous les sites : modification réservée à un rôle à périmètre global.");
  }
}

/** Loads the client's equipment register and commissioning checklist. Idempotent: does nothing if already loaded. */
export async function seedEquipmentReference(): Promise<void> {
  if ((await repositories.equipment.list()).length === 0) {
    await repositories.equipment.createMany(equipmentReference.items.map((i) => ({ ...i, reference: i.reference ?? null, quantityRef: i.quantityRef ?? null, quantityMax: i.quantityMax ?? null })));
  }
  if ((await repositories.equipment.listTests()).length === 0) {
    await repositories.equipment.createTests(
      COMMISSIONING_REFERENCE.map((t) => ({ ...t, result: "A_FAIRE" as const, executedBy: null, executedAt: null, evidence: null, notes: null }))
    );
  }
}

export interface UnitSummary {
  unitCode: string;
  unitLabel: string;
  existing: number;
  baseRefs: number;
  baseQty: number;
  optionRefs: number;
  optionQtyRef: number;
  optionQtyMax: number;
  consumables: number;
}

/** Same indicators as the client's "Synthese" sheet, recomputed live from the register. */
export function summarize(items: EquipmentItem[]): UnitSummary[] {
  const byUnit = new Map<string, UnitSummary>();
  for (const i of items) {
    const s = byUnit.get(i.unitCode) ?? { unitCode: i.unitCode, unitLabel: i.unitLabel, existing: 0, baseRefs: 0, baseQty: 0, optionRefs: 0, optionQtyRef: 0, optionQtyMax: 0, consumables: 0 };
    if (i.category === "Existant client") s.existing += 1;
    else if (i.category === "BVU Tech — base") {
      s.baseRefs += 1;
      s.baseQty += i.quantityRef ?? 0;
    } else if (i.category === "BVU Tech — option") {
      s.optionRefs += 1;
      s.optionQtyRef += i.quantityRef ?? 0;
      s.optionQtyMax += i.quantityMax ?? 0;
    } else if (i.category === "Consommable") s.consumables += 1;
    byUnit.set(i.unitCode, s);
  }
  return [...byUnit.values()].sort((a, b) => a.unitCode.localeCompare(b.unitCode));
}

export async function listEquipment(session: Session): Promise<EquipmentItem[]> {
  if (!can(session, "VIEW", "EQUIPMENT")) throw new AuthorizationError();
  return repositories.equipment.list();
}

const optionalQty = z.number().nonnegative().nullable();
export const updateEquipmentSchema = z
  .object({
    id: z.string().min(1),
    quantityRef: optionalQty,
    quantityMax: optionalQty,
    status: z.string().refine((s) => s in EQUIPMENT_STATUS_LABEL, "Statut inconnu."),
    decisionRule: z.string().trim().max(1000).nullable(),
  })
  .refine((v) => v.quantityRef === null || v.quantityMax === null || v.quantityMax >= v.quantityRef, "La quantité maximale ne peut pas être inférieure à la quantité de référence.");

/** Post-audit edit of the columns the client marked as editable: Qté réf., Qté max, Statut, Remarque. */
export async function updateEquipment(input: unknown, session: Session): Promise<EquipmentItem> {
  assertCanEditRegister(session);
  const parsed = updateEquipmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const existing = await repositories.equipment.findById(parsed.data.id);
  if (!existing) throw new NotFoundError("Équipement", parsed.data.id);
  const { id, ...changes } = parsed.data;
  const updated = await repositories.equipment.update(id, { ...changes, updatedAt: new Date().toISOString(), updatedBy: session.userId });
  await recordAudit({
    actorId: session.userId,
    entityType: "equipment_item",
    entityId: id,
    field: "quantité/statut",
    oldValue: `${existing.quantityRef ?? "—"}/${existing.quantityMax ?? "—"} ${existing.status ?? ""}`,
    newValue: `${updated.quantityRef ?? "—"}/${updated.quantityMax ?? "—"} ${updated.status ?? ""}`,
    reason: `Mise à jour après audit — ${existing.unitCode} · ${existing.name}`,
    relatedLotId: null,
    relatedEventId: null,
  });
  return updated;
}

/** Exports what the screen shows: the same unit/category filters apply. */
export async function exportEquipmentCsv(session: Session, filters: { unitCode?: string | null; category?: string | null } = {}): Promise<string> {
  const items = (await listEquipment(session)).filter(
    (i) => (!filters.unitCode || i.unitCode === filters.unitCode) && (!filters.category || i.category === filters.category)
  );
  const header = ["Unité", "Catégorie", "Réf. classeur", "Équipement", "Qté réf.", "Qté max", "Statut", "Fonction", "Caractéristiques", "Remarque", "Candidats"];
  const rows = items.map((i) =>
    [i.unitLabel, i.category, i.reference, i.name, i.quantityRef?.toString() ?? null, i.quantityMax?.toString() ?? null, i.status ? `${i.status} — ${EQUIPMENT_STATUS_LABEL[i.status] ?? ""}` : null, i.function, i.characteristics, i.decisionRule, i.candidates].map(csvField).join(",")
  );
  return "﻿" + [header.join(","), ...rows].join("\r\n");
}

export async function listCommissioningTests(session: Session): Promise<(CommissioningTest & { executedByName: string | null })[]> {
  if (!can(session, "VIEW", "EQUIPMENT")) throw new AuthorizationError();
  const [tests, users] = await Promise.all([repositories.equipment.listTests(), repositories.users.list()]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return tests.map((t) => ({ ...t, executedByName: t.executedBy ? (name.get(t.executedBy) ?? null) : null }));
}

export const recordCommissioningSchema = z.object({
  id: z.string().min(1),
  result: z.enum(COMMISSIONING_RESULT).refine((r) => r !== "A_FAIRE", "Indiquez un résultat."),
  evidence: z.string().trim().min(3, "Une preuve (PV, photo, relevé) est requise.").max(500),
  notes: z.string().trim().max(1000).nullable(),
});

/** Records a commissioning result with its evidence. A re-test is a new recorded result, audited, never a silent edit. */
export async function recordCommissioningResult(input: unknown, session: Session): Promise<CommissioningTest> {
  assertCanEditRegister(session);
  const parsed = recordCommissioningSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const existing = await repositories.equipment.findTestById(parsed.data.id);
  if (!existing) throw new NotFoundError("Recette", parsed.data.id);
  const updated = await repositories.equipment.updateTest(existing.id, {
    result: parsed.data.result,
    evidence: parsed.data.evidence,
    notes: parsed.data.notes,
    executedBy: session.userId,
    executedAt: new Date().toISOString(),
  });
  await recordAudit({
    actorId: session.userId,
    entityType: "commissioning_test",
    entityId: existing.id,
    field: "result",
    oldValue: existing.result,
    newValue: parsed.data.result,
    reason: `Recette ${existing.code} (${existing.equipment}) — preuve : ${parsed.data.evidence}`,
    relatedLotId: null,
    relatedEventId: null,
  });
  return updated;
}
