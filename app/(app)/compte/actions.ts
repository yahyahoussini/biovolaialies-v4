"use server";

import type { PublicError } from "@/domain/shared/errors";
import { handleActionError } from "@/lib/handle-error";
import { adoptAuthVersion, requireSession } from "@/services/auth/session";
import { changeOwnPassword, confirmMfaEnrollment, disableMfa, regenerateRecoveryCodes } from "@/services/identity/account-security";

export interface AccountActionResult {
  ok: boolean;
  recoveryCodes?: string[];
  next?: undefined;
  error?: PublicError;
}

/** Each change that ends the other sessions keeps this one (adoptAuthVersion). */
export async function changePasswordAction(currentPassword: string, newPassword: string): Promise<AccountActionResult> {
  try {
    const session = await requireSession();
    const { authVersion } = await changeOwnPassword({ currentPassword, newPassword }, session);
    await adoptAuthVersion(authVersion);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function confirmOwnMfaAction(code: string): Promise<AccountActionResult> {
  try {
    const session = await requireSession();
    const { user, recoveryCodes } = await confirmMfaEnrollment(session.userId, code);
    await adoptAuthVersion(user.authVersion);
    return { ok: true, recoveryCodes };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function disableMfaAction(currentPassword: string): Promise<AccountActionResult> {
  try {
    const session = await requireSession();
    const { authVersion } = await disableMfa(currentPassword, session);
    await adoptAuthVersion(authVersion);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}

export async function regenerateCodesAction(currentPassword: string): Promise<AccountActionResult> {
  try {
    const session = await requireSession();
    const { recoveryCodes } = await regenerateRecoveryCodes(currentPassword, session);
    return { ok: true, recoveryCodes };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
