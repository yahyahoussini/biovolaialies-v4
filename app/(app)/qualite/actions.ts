"use server";

import { revalidatePath } from "next/cache";
import type { PublicError } from "@/domain/shared/errors";
import { isEntityType } from "@/domain/traceability/entity-types";
import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import { decideHold, openHold } from "@/services/quality/holds";
import { findEntityIdByCode } from "@/services/traceability/lookup";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: PublicError;
}

export async function openHoldAction(input: {
  rootType: string;
  code: string;
  reason: string;
  description: string;
  scope: string;
  evidence: string;
}): Promise<ActionResult<{ caseId: string }>> {
  try {
    const session = await requireSession();
    if (!isEntityType(input.rootType)) {
      return { ok: false, error: { kind: "VALIDATION", message: "Type d'objet inconnu." } };
    }
    const rootId = await findEntityIdByCode(input.rootType, input.code);
    if (!rootId) {
      return { ok: false, error: { kind: "NOT_FOUND", message: `Aucun objet avec le code « ${input.code} ».` } };
    }
    const created = await openHold({ ...input, rootId }, session);
    revalidatePath("/qualite");
    return { ok: true, data: { caseId: created.id } };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function decideHoldAction(input: {
  caseId: string;
  decision: string;
  justification: string;
  evidence: string;
}): Promise<ActionResult> {
  try {
    const session = await requireSession();
    await decideHold(input, session);
    revalidatePath("/qualite");
    revalidatePath(`/qualite/${input.caseId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
