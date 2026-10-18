"use server";

import { revalidatePath } from "next/cache";
import type { PublicError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import { updateLead } from "@/services/leads/leads";

export interface ActionResult {
  ok: boolean;
  error?: PublicError;
}

export async function updateLeadAction(leadId: string, status: string, notes: string): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await updateLead({ leadId, status, notes: notes.trim() === "" ? null : notes }, session);
    revalidatePath("/prospects");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
