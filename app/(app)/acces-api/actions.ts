"use server";

import { revalidatePath } from "next/cache";
import type { PublicError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { requireSession } from "@/services/auth/session";
import { createApiClient, revokeApiClient } from "@/services/api/clients";

export async function createApiClientAction(name: string, scopes: string[]): Promise<{ ok: boolean; key?: string; error?: PublicError }> {
  try {
    const session = await requireSession();
    const { key } = await createApiClient({ name, scopes }, session);
    revalidatePath("/acces-api");
    return { ok: true, key };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function revokeApiClientAction(clientId: string): Promise<{ ok: boolean; error?: PublicError }> {
  try {
    const session = await requireSession();
    await revokeApiClient(clientId, session);
    revalidatePath("/acces-api");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
