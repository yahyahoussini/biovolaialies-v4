"use server";

import { handleActionError } from "@/lib/handle-error";
import type { PublicError } from "@/domain/shared/errors";
import { clientInfo } from "@/lib/client-info";
import { login } from "@/services/auth/login";

export interface LoginActionResult {
  ok: boolean;
  error?: PublicError;
}

export async function loginAction(email: string, password: string): Promise<LoginActionResult> {
  try {
    const result = await login(email, password, { client: await clientInfo() });
    if (!result.ok) {
      return { ok: false, error: { kind: "VALIDATION", message: result.error } };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}
