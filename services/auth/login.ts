import type { IronSession } from "iron-session";
import { repositories } from "../../data/repositories";
import { mfaRequired } from "../../domain/identity/password-policy";
import type { User } from "../../domain/identity/types";
import type { Role } from "../../domain/shared/enums";
import { err, ok, type Result } from "../../domain/shared/result";
import { isDemoInstallation } from "../../lib/env";
import { hashPassword, verifyPassword } from "../../lib/password";
import { looksLikeRecoveryCode, verifyTotp } from "../../lib/totp";
import { recordAudit } from "../audit/record";
import type { SessionData, SignInRestriction } from "./config";
import { recordAuthEvent, signInRefusal, type ClientInfo } from "./journal";
import { openTotpSecret } from "./mfa-secret";
import { consumeRecoveryCode } from "./recovery-codes";
import { getMutableIronSession, PENDING_SECOND_FACTOR_MS, sessionStillValid } from "./session";

import type { SignInNext } from "../../lib/sign-in-steps";

export type { SignInNext };

export interface LoginSuccess {
  userId: string;
  role: Role;
  next: SignInNext;
}

const INVALID_CREDENTIALS = "Email ou mot de passe incorrect.";

/** Constant-shape hash so a lookup miss takes about as long as a wrong password (avoids user-enumeration via timing). */
const DUMMY_HASH = hashPassword(crypto.randomUUID());

function clearSignIn(session: IronSession<SessionData>): void {
  for (const key of ["userId", "role", "scopeType", "scopeId", "isDemoSwitch", "authVersion", "restriction", "pendingUserId", "pendingAt", "pendingAuthVersion"] as const) {
    delete session[key];
  }
}

/** The step a sign-in still owes before the application opens, if any. None for the demo role switcher. */
export function nextRestriction(user: User, demo: boolean, demoInstallation = isDemoInstallation()): SignInRestriction | null {
  if (demo) return null;
  if (user.mustChangePassword) return "PASSWORD_CHANGE";
  if (mfaRequired(user.role, demoInstallation) && !user.totpEnabledAt) return "MFA_SETUP";
  return null;
}

/**
 * Opens the session for an account whose identity is proven — restricted while a step remains —
 * and says what comes next. Called again after each step, with the account as it now is.
 */
export async function openSession(user: User, options: { demo: boolean; client?: ClientInfo }): Promise<LoginSuccess> {
  const session = await getMutableIronSession();
  const restriction = nextRestriction(user, options.demo);
  clearSignIn(session);
  session.userId = user.id;
  session.role = user.role;
  session.scopeType = user.scopeType;
  session.scopeId = user.scopeId;
  session.isDemoSwitch = options.demo;
  session.authVersion = user.authVersion;
  if (restriction) session.restriction = restriction;
  await session.save();
  if (!restriction) {
    await repositories.users.touchLastLogin(user.id, new Date().toISOString());
    await recordAuthEvent({ email: user.email, userId: user.id, outcome: options.demo ? "BASCULE_DEMO" : "SUCCES", client: options.client });
  }
  return { userId: user.id, role: user.role, next: restriction ?? "DONE" };
}

export async function login(
  email: string,
  password: string,
  options?: { demo?: boolean; client?: ClientInfo }
): Promise<Result<LoginSuccess, string>> {
  const refusal = await signInRefusal(email, options?.client);
  if (refusal) {
    await recordAuthEvent({ email, userId: null, outcome: "BLOQUE", client: options?.client });
    return err(refusal);
  }
  const user = await repositories.users.findByEmail(email.toLowerCase());

  const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !valid) {
    await recordAuthEvent({ email, userId: user?.id ?? null, outcome: "ECHEC", client: options?.client, detail: !user ? "Compte inconnu" : !user.active ? "Compte désactivé" : "Mot de passe incorrect" });
    return err(INVALID_CREDENTIALS);
  }

  if (!options?.demo && user.totpEnabledAt) {
    const session = await getMutableIronSession();
    clearSignIn(session);
    session.pendingUserId = user.id;
    session.pendingAt = Date.now();
    session.pendingAuthVersion = user.authVersion;
    await session.save();
    return ok({ userId: user.id, role: user.role, next: "SECOND_FACTOR" });
  }

  return ok(await openSession(user, { demo: options?.demo ?? false, client: options?.client }));
}

/**
 * The second step for an account with two-step login: a six-digit code from the app, or one of its
 * recovery codes. Wrong codes count as failed sign-ins (journal.ts): five, and the account waits.
 */
export async function verifySecondFactor(code: string, client?: ClientInfo, now = Date.now()): Promise<Result<LoginSuccess, string>> {
  const session = await getMutableIronSession();
  const pendingId = session.pendingUserId;
  const fresh = Boolean(pendingId && session.pendingAt && now - session.pendingAt <= PENDING_SECOND_FACTOR_MS);
  const user = fresh && pendingId ? await repositories.users.findById(pendingId) : null;
  if (!sessionStillValid(user, session.pendingAuthVersion) || !user.totpEnabledAt) {
    clearSignIn(session);
    await session.save();
    return err("Étape expirée : reconnectez-vous avec votre mot de passe.");
  }

  const refusal = await signInRefusal(user.email, client);
  if (refusal) {
    await recordAuthEvent({ email: user.email, userId: user.id, outcome: "BLOQUE", client });
    return err(refusal);
  }

  const secret = openTotpSecret(user.totpSecret);
  const step = secret ? verifyTotp(secret, code, now, user.totpLastStep) : null;
  if (step !== null) {
    const updated = await repositories.users.updateSecurity(user.id, { totpLastStep: step });
    return ok(await openSession(updated, { demo: false, client }));
  }

  if (looksLikeRecoveryCode(code)) {
    const used = consumeRecoveryCode(user.recoveryCodes, code);
    if (used) {
      const updated = await repositories.users.updateSecurity(user.id, { recoveryCodes: used.json });
      await recordAudit({
        actorId: user.id,
        entityType: "user",
        entityId: user.id,
        field: "mfa",
        oldValue: null,
        newValue: null,
        reason: `Connexion avec un code de secours (${used.left} restant${used.left > 1 ? "s" : ""})`,
        relatedLotId: null,
        relatedEventId: null,
      });
      return ok(await openSession(updated, { demo: false, client }));
    }
  }

  await recordAuthEvent({ email: user.email, userId: user.id, outcome: "ECHEC", client, detail: secret ? "Code de double authentification incorrect" : "Clé de double authentification illisible" });
  return err(secret ? "Code incorrect." : "Double authentification illisible sur ce serveur : demandez à l'administrateur de la réinitialiser.");
}
