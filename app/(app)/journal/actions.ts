"use server";

import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import { verifyAgainstAnchor } from "@/services/ledger/ledger";

export async function verifyAnchorAction(raw: string): Promise<{ ok: boolean; message: string }> {
  try {
    const session = await requireSession();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, message: "Le contenu collé n'est pas un JSON valide." };
    }
    const result = await verifyAgainstAnchor(session, parsed);
    return { ok: result.ok, message: result.message };
  } catch (error) {
    return { ok: false, message: handleActionError("server-action", error).message };
  }
}
