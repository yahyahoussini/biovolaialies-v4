"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { recordCommissioningResult, updateEquipment } from "@/services/equipment/equipment";

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
    await recordCommissioningResult({ id: v.id, result: v.result, evidence: v.evidence, notes: opt(v.notes) }, session);
    revalidatePath("/equipements/recette");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
