"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { num } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { resolveMortalityDiscrepancy } from "@/services/field/sync";

export async function resolveDiscrepancyAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await resolveMortalityDiscrepancy({ discrepancyId: v.discrepancyId, count: num(v.count), note: v.note }, session);
    revalidatePath("/saisies-terrain");
    revalidatePath("/lots", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
