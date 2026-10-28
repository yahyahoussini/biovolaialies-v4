import { repositories } from "../../data/repositories";
import type { Role } from "../../domain/shared/enums";
import { err, ok, type Result } from "../../domain/shared/result";
import { hashPassword, verifyPassword } from "../../lib/password";
import { recordAuthEvent, signInRefusal, type ClientInfo } from "./journal";
import { getMutableIronSession } from "./session";

export interface LoginSuccess {
  userId: string;
  role: Role;
}

const INVALID_CREDENTIALS = "Email ou mot de passe incorrect.";

/** Constant-shape hash so a lookup miss takes about as long as a wrong password (avoids user-enumeration via timing). */
const DUMMY_HASH = hashPassword(crypto.randomUUID());

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

  const session = await getMutableIronSession();
  session.userId = user.id;
  session.role = user.role;
  session.scopeType = user.scopeType;
  session.scopeId = user.scopeId;
  session.isDemoSwitch = options?.demo ?? false;
  await session.save();

  await repositories.users.touchLastLogin(user.id, new Date().toISOString());
  await recordAuthEvent({ email, userId: user.id, outcome: options?.demo ? "BASCULE_DEMO" : "SUCCES", client: options?.client });

  return ok({ userId: user.id, role: user.role });
}
