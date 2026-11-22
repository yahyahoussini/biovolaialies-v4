"use server";

import { handleActionError } from "@/lib/handle-error";
import type { PublicError } from "@/domain/shared/errors";
import { clientInfo } from "@/lib/client-info";
import type { SignInNext } from "@/lib/sign-in-steps";
import { login, openSession, verifySecondFactor } from "@/services/auth/login";
import { getSignInStage } from "@/services/auth/session";
import { confirmMfaEnrollment, replaceTemporaryPassword } from "@/services/identity/account-security";

export interface LoginActionResult {
  ok: boolean;
  next?: SignInNext;
  error?: PublicError;
}

const expired = (): LoginActionResult => ({ ok: false, error: { kind: "VALIDATION", message: "Étape expirée : reconnectez-vous avec votre mot de passe." } });

export async function loginAction(email: string, password: string): Promise<LoginActionResult> {
  try {
    const result = await login(email, password, { client: await clientInfo() });
    if (!result.ok) {
      return { ok: false, error: { kind: "VALIDATION", message: result.error } };
    }
    return { ok: true, next: result.value.next };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}

/** Second step: the code from the authenticator app, or a recovery code. */
export async function verifyCodeAction(code: string): Promise<LoginActionResult> {
  try {
    const result = await verifySecondFactor(code, await clientInfo());
    if (!result.ok) return { ok: false, error: { kind: "VALIDATION", message: result.error } };
    return { ok: true, next: result.value.next };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}

/** The temporary password an administrator chose is replaced by the user's own. */
export async function setNewPasswordAction(newPassword: string): Promise<LoginActionResult> {
  try {
    const stage = await getSignInStage();
    if (stage?.kind !== "PASSWORD_CHANGE") return expired();
    const updated = await replaceTemporaryPassword(stage.user.id, newPassword);
    const opened = await openSession(updated, { demo: false, client: await clientInfo() });
    return { ok: true, next: opened.next };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}

export interface MfaConfirmResult extends LoginActionResult {
  recoveryCodes?: string[];
}

/**
 * Two-step login set up during the sign-in of a role that requires it. The session cookie is not
 * touched here: a changed cookie makes Next.js re-render the page, which would take the recovery
 * codes off the screen before they were kept. finishSignInAction() opens the session afterwards.
 */
export async function confirmMfaSetupAction(code: string): Promise<MfaConfirmResult> {
  try {
    const stage = await getSignInStage();
    if (stage?.kind !== "MFA_SETUP") return expired();
    const { recoveryCodes } = await confirmMfaEnrollment(stage.user.id, code, Date.now(), { endOtherSessions: false });
    return { ok: true, recoveryCodes };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}

/** Once the recovery codes are kept: the sign-in goes on (the application, or a remaining step). */
export async function finishSignInAction(): Promise<LoginActionResult> {
  try {
    const stage = await getSignInStage();
    if (stage?.kind !== "MFA_SETUP" || !stage.user.totpEnabledAt) return expired();
    const opened = await openSession(stage.user, { demo: false, client: await clientInfo() });
    return { ok: true, next: opened.next };
  } catch (error) {
    return { ok: false, error: handleActionError("auth", error) };
  }
}
