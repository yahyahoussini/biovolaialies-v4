import { randomBytes } from "node:crypto";
import { repositories } from "../../data/repositories";
import { generateTemporaryPassword, mfaRequired, passwordProblem } from "../../domain/identity/password-policy";
import type { User } from "../../domain/identity/types";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isDemoInstallation } from "../../lib/env";
import { hashPassword, verifyPassword } from "../../lib/password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../lib/totp";
import { recordAudit } from "../audit/record";
import { openTotpSecret, sealTotpSecret } from "../auth/mfa-secret";
import { issueRecoveryCodes, recoveryCodesLeft } from "../auth/recovery-codes";
import type { Session } from "../auth/session";

/**
 * Passwords and two-step login. Every change that should end the sessions already open elsewhere
 * bumps users.auth_version; the caller then keeps its own session with adoptAuthVersion(). No
 * password, code or secret ever reaches the audit trail — only that the change happened.
 */

async function userOrThrow(id: string): Promise<User> {
  const user = await repositories.users.findById(id);
  if (!user) throw new NotFoundError("Utilisateur", id);
  return user;
}

const audit = (actorId: string, userId: string, field: "password" | "mfa", reason: string) =>
  recordAudit({ actorId, entityType: "user", entityId: userId, field, oldValue: null, newValue: null, reason, relatedLotId: null, relatedEventId: null });

function assertAcceptable(user: User, password: string): void {
  const problem = passwordProblem(password, user.email);
  if (problem) throw new ValidationError(problem);
  if (verifyPassword(password, user.passwordHash)) throw new ValidationError("Choisissez un mot de passe différent de l'actuel.");
}

async function storePassword(user: User, password: string, mustChange: boolean): Promise<User> {
  return repositories.users.updateSecurity(user.id, {
    passwordHash: hashPassword(password),
    mustChangePassword: mustChange,
    passwordChangedAt: new Date().toISOString(),
    authVersion: user.authVersion + 1,
  });
}

/** The user changes their own password, proving the current one. Returns the new session version. */
export async function changeOwnPassword(input: { currentPassword: string; newPassword: string }, session: Session): Promise<{ authVersion: number }> {
  const user = await userOrThrow(session.userId);
  if (!verifyPassword(input.currentPassword, user.passwordHash)) throw new ValidationError("Mot de passe actuel incorrect.");
  assertAcceptable(user, input.newPassword);
  const updated = await storePassword(user, input.newPassword, false);
  await audit(session.userId, user.id, "password", "Mot de passe changé par l'utilisateur");
  return { authVersion: updated.authVersion };
}

/** At sign-in, the password an administrator chose is replaced (the sign-in step proves who this is). */
export async function replaceTemporaryPassword(userId: string, newPassword: string): Promise<User> {
  const user = await userOrThrow(userId);
  if (!user.mustChangePassword) throw new ConflictError("Ce mot de passe n'est pas provisoire.");
  assertAcceptable(user, newPassword);
  const updated = await storePassword(user, newPassword, false);
  await audit(user.id, user.id, "password", "Mot de passe provisoire remplacé à la connexion");
  return updated;
}

/** An administrator gives a temporary password, shown once; the user must replace it at the next sign-in. */
export async function adminResetPassword(userId: string, session: Session): Promise<{ temporaryPassword: string }> {
  if (!can(session, "EDIT", "USERS")) throw new AuthorizationError("Vous n'avez pas les droits pour réinitialiser un mot de passe.");
  if (userId === session.userId) throw new ConflictError("Changez votre propre mot de passe depuis « Mon compte ».");
  const user = await userOrThrow(userId);
  const temporaryPassword = generateTemporaryPassword((n) => randomBytes(n));
  await storePassword(user, temporaryPassword, true);
  await audit(session.userId, user.id, "password", "Mot de passe réinitialisé par un administrateur (provisoire, à changer à la connexion)");
  return { temporaryPassword };
}

/**
 * Starts (or resumes) setting up two-step login: a secret is kept, encrypted, until a first code
 * proves the app has it. Returns what the app needs: the secret and the otpauth URI for the QR code.
 */
export async function beginMfaEnrollment(userId: string): Promise<{ secret: string; uri: string }> {
  const user = await userOrThrow(userId);
  if (user.totpEnabledAt) throw new ConflictError("La double authentification est déjà activée.");
  let secret = openTotpSecret(user.totpSecret);
  if (!secret) {
    secret = generateTotpSecret();
    await repositories.users.updateSecurity(user.id, { totpSecret: sealTotpSecret(secret), totpLastStep: null });
  }
  return { secret, uri: otpauthUri(secret, user.email) };
}

/**
 * A first code from the app turns two-step login on; ten recovery codes are issued, shown once.
 * From "Mon compte" the other sessions end (`endOtherSessions`); during a sign-in there are none to
 * end, and the restricted session must survive until the user has kept the codes.
 */
export async function confirmMfaEnrollment(userId: string, code: string, now = Date.now(), options: { endOtherSessions?: boolean } = {}): Promise<{ user: User; recoveryCodes: string[] }> {
  const user = await userOrThrow(userId);
  if (user.totpEnabledAt) throw new ConflictError("La double authentification est déjà activée.");
  const secret = openTotpSecret(user.totpSecret);
  if (!secret) throw new ConflictError("Recommencez l'activation : la clé n'est plus lisible.");
  const step = verifyTotp(secret, code, now, null);
  if (step === null) throw new ValidationError("Code incorrect : vérifiez l'heure du téléphone et saisissez le code affiché.");
  const { codes, json } = issueRecoveryCodes();
  const updated = await repositories.users.updateSecurity(user.id, {
    totpEnabledAt: new Date(now).toISOString(),
    totpLastStep: step,
    recoveryCodes: json,
    authVersion: options.endOtherSessions === false ? user.authVersion : user.authVersion + 1,
  });
  await audit(user.id, user.id, "mfa", "Double authentification activée");
  return { user: updated, recoveryCodes: codes };
}

/** The user turns two-step login off — not allowed where the role requires it. */
export async function disableMfa(currentPassword: string, session: Session): Promise<{ authVersion: number }> {
  const user = await userOrThrow(session.userId);
  if (mfaRequired(user.role, isDemoInstallation())) throw new AuthorizationError("La double authentification est obligatoire pour votre rôle.");
  if (!verifyPassword(currentPassword, user.passwordHash)) throw new ValidationError("Mot de passe incorrect.");
  if (!user.totpEnabledAt) return { authVersion: user.authVersion };
  const updated = await repositories.users.updateSecurity(user.id, { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null, authVersion: user.authVersion + 1 });
  await audit(user.id, user.id, "mfa", "Double authentification désactivée par l'utilisateur");
  return { authVersion: updated.authVersion };
}

/** Ten new recovery codes; the old ones stop working. */
export async function regenerateRecoveryCodes(currentPassword: string, session: Session): Promise<{ recoveryCodes: string[] }> {
  const user = await userOrThrow(session.userId);
  if (!user.totpEnabledAt) throw new ConflictError("La double authentification n'est pas activée.");
  if (!verifyPassword(currentPassword, user.passwordHash)) throw new ValidationError("Mot de passe incorrect.");
  const { codes, json } = issueRecoveryCodes();
  await repositories.users.updateSecurity(user.id, { recoveryCodes: json });
  await audit(user.id, user.id, "mfa", "Codes de secours renouvelés");
  return { recoveryCodes: codes };
}

/** Phone lost and no recovery code left: an administrator removes the two-step login; it is set up again at the next sign-in where the role requires it. */
export async function adminResetMfa(userId: string, session: Session): Promise<void> {
  if (!can(session, "EDIT", "USERS")) throw new AuthorizationError("Vous n'avez pas les droits pour réinitialiser la double authentification.");
  if (userId === session.userId) throw new ConflictError("Un autre administrateur doit réinitialiser votre double authentification.");
  const user = await userOrThrow(userId);
  await repositories.users.updateSecurity(user.id, { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null, authVersion: user.authVersion + 1 });
  await audit(session.userId, user.id, "mfa", "Double authentification réinitialisée par un administrateur");
}

export interface AccountOverview {
  email: string;
  fullName: string;
  role: User["role"];
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  recoveryCodesLeft: number;
}

export async function accountOverview(session: Session): Promise<AccountOverview> {
  const user = await userOrThrow(session.userId);
  return {
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    passwordChangedAt: user.passwordChangedAt,
    mfaEnabled: Boolean(user.totpEnabledAt),
    mfaRequired: mfaRequired(user.role, isDemoInstallation()),
    recoveryCodesLeft: recoveryCodesLeft(user.recoveryCodes),
  };
}

/** What an administrator sees of someone's account security on the user page. */
export function securitySummary(user: User): { mustChangePassword: boolean; mfaEnabled: boolean; recoveryCodesLeft: number; passwordChangedAt: string | null } {
  return { mustChangePassword: user.mustChangePassword, mfaEnabled: Boolean(user.totpEnabledAt), recoveryCodesLeft: recoveryCodesLeft(user.recoveryCodes), passwordChangedAt: user.passwordChangedAt };
}
