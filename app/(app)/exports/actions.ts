"use server";

import { handleActionError } from "@/lib/handle-error";
import type { PublicError } from "@/domain/shared/errors";
import { requireSession } from "@/services/auth/session";
import { verifyExport, type VerifyOutcome } from "@/services/exports/exports";

export async function verifyExportAction(digest: string): Promise<{ ok: true; outcome: VerifyOutcome } | { ok: false; error: PublicError }> {
  try {
    await requireSession();
    return { ok: true, outcome: await verifyExport(digest) };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
