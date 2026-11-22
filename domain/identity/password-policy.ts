import type { Role } from "../shared/enums";

/**
 * What a password must be, and who must use two-step login. Pure: the services decide when to
 * apply it, and whether the installation is a demonstration (where it does not apply).
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** The ones people reach for first; the demonstration password is public, so it is refused too. */
const COMMON = new Set([
  "demo1234!",
  "motdepasse",
  "motdepasse1",
  "motdepasse123",
  "password",
  "password1",
  "password123",
  "1234567890",
  "12345678910",
  "azertyuiop",
  "qwertyuiop",
  "biovolailles",
  "biovolailles1",
  "bienvenue123",
  "maroc12345",
  "morocco123",
]);

/** Why a password is refused, or null when it is acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `${PASSWORD_MIN_LENGTH} caractères minimum.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `${PASSWORD_MAX_LENGTH} caractères maximum.`;
  const lowered = password.toLowerCase();
  if (COMMON.has(lowered)) return "Ce mot de passe est trop courant : choisissez-en un autre.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lowered.includes(local)) return "Le mot de passe ne doit pas reprendre votre adresse e-mail.";
  if (new Set(password).size < 5) return "Mot de passe trop répétitif : variez les caractères.";
  return null;
}

/** The roles whose accounts must use two-step login on a real installation: they release, decide and administer. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["SUPER_ADMIN", "QUALITY_MANAGER", "DIRECTION"];

export function mfaRequired(role: Role, demoInstallation: boolean): boolean {
  return !demoInstallation && MFA_REQUIRED_ROLES.includes(role);
}

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A temporary password an administrator reads out once: 3 groups of 4, about 59 bits. */
export function generateTemporaryPassword(random: (n: number) => Uint8Array): string {
  const bytes = random(12);
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
