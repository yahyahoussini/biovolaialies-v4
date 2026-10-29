"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { recordCommissioning } from "@/services/equipment/commissioning";
import { updateEquipment } from "@/services/equipment/equipment";
import { updateNomenclatureArticle } from "@/services/equipment/nomenclature";

export async function updateEquipmentAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await updateEquipment({ id: v.id, quantityRef: num(v.quantityRef) ?? null, quantityMax: num(v.quantityMax) ?? null, status: v.status, decisionRule: opt(v.decisionRule) }, session);
    revalidatePath("/equipements");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function recordCommissioningAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await recordCommissioning(
      { buildingId: v.buildingId, code: v.code, result: v.result, performedAt: v.performedAt, performedBy: v.performedBy, measured: opt(v.measured), evidence: v.evidence, notes: opt(v.notes) },
      session
    );
    revalidatePath("/equipements/recette");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function updateNomenclatureAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await updateNomenclatureArticle(
      {
        ref: v.ref,
        manufacturer: opt(v.manufacturer),
        quantity: num(v.quantity) ?? NaN,
        quantityFormula: opt(v.quantityFormula),
        location: opt(v.location),
        function: opt(v.function),
        specifications: opt(v.specifications),
        communication: opt(v.communication),
        power: opt(v.power),
        connectors: opt(v.connectors),
        cables: opt(v.cables),
        priceLowMad: num(v.priceLowMad) ?? NaN,
        priceHighMad: num(v.priceHighMad) ?? NaN,
        priceConfidence: v.priceConfidence,
        priceDate: opt(v.priceDate),
        installation: opt(v.installation),
        spares: opt(v.spares),
        maintenance: opt(v.maintenance),
        reason: v.reason,
      },
      session
    );
    revalidatePath("/equipements/nomenclature");
    revalidatePath(`/equipements/nomenclature/${v.ref}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
