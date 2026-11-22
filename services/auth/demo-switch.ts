import { DEMO_ACCOUNT_EMAIL, DEMO_PASSWORD } from "../../data/seed/generators/hierarchy";
import { ROLE, type Role } from "../../domain/shared/enums";
import { err, type Result } from "../../domain/shared/result";
import type { ClientInfo } from "./journal";
import { login, type LoginSuccess } from "./login";
import { env } from "../../lib/env";

/**
 * The switcher exists only where every demo account and its shared password are public anyway:
 * demo mode, or the bundled demo snapshot. On a real installation it would let any signed-in
 * user become the seeded administrator, so it is refused here, whatever the interface shows.
 */
export function demoRoleSwitchAllowed(): boolean {
  return env.DEMO_MODE || env.DATABASE_SNAPSHOT;
}

/**
 * The seeded demo Role Switcher (phase-8 brief §6). This is a REAL re-authentication —
 * it looks up the fixed seeded demo account for the requested role and runs it through the
 * exact same login() path a manual email/password submission would (same credential check,
 * same session mint), just with the demo flag set so the UI can show "Mode démo" unambiguously.
 * It is deliberately NOT a client-side role toggle: nothing here writes role/scope into the
 * session without a real user row and a real password check backing it.
 */
export async function switchToDemoRole(role: string, client?: ClientInfo): Promise<Result<LoginSuccess, string>> {
  if (!demoRoleSwitchAllowed()) {
    return err("Le changement de rôle n'existe qu'en démonstration.");
  }
  if (!(ROLE as readonly string[]).includes(role)) {
    return err("Rôle invalide.");
  }
  const email = DEMO_ACCOUNT_EMAIL[role as Role];
  return login(email, DEMO_PASSWORD, { demo: true, client });
}
