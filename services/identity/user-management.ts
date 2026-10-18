import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { User } from "../../domain/identity/types";
import { ROLE, SCOPE_TYPE, type Role, type ScopeType } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { hashPassword } from "../../lib/password";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

/**
 * User management (phase-8 brief §4). Gated on the USERS module, which today only
 * SUPER_ADMIN holds any permission for (domain/shared/permissions.ts) — so every function
 * here is, in effect, SUPER_ADMIN-only, enforced the same way as every other module (`can()`),
 * not a separate hardcoded role check.
 */

async function getUserOrThrow(userId: string): Promise<User> {
  const user = await repositories.users.findById(userId);
  if (!user) throw new NotFoundError("User", userId);
  return user;
}

/** A user's scopeId, when not GLOBAL, must resolve to a real row of the claimed scopeType — same invariant the integrity center checks (T25). */
export async function assertScopeTargetExists(scopeType: ScopeType, scopeId: string | null): Promise<void> {
  if (scopeType === "GLOBAL") {
    if (scopeId !== null) throw new ValidationError("Un périmètre global ne prend pas d'identifiant.");
    return;
  }
  if (!scopeId) throw new ValidationError("Un identifiant de périmètre est requis pour ce type de périmètre.");

  const exists = await (async () => {
    switch (scopeType) {
      case "ORGANIZATION":
        return Boolean(await repositories.organizations.findById(scopeId));
      case "COOPERATIVE":
        return Boolean(await repositories.cooperatives.findById(scopeId));
      case "PRODUCER":
        return Boolean(await repositories.producers.findById(scopeId));
      case "FARM":
        return Boolean(await repositories.farms.findById(scopeId));
    }
  })();
  if (!exists) throw new ValidationError("Le périmètre indiqué n'existe pas.");
}

export async function listUsers(session: Session): Promise<User[]> {
  if (!can(session, "VIEW", "USERS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour consulter les utilisateurs.");
  }
  return repositories.users.list();
}

/** Human-readable label for a user's scope target — "Global" or the name of the org/coop/producer/farm it points to. */
export async function describeScopeTarget(scopeType: ScopeType, scopeId: string | null): Promise<string> {
  if (scopeType === "GLOBAL" || !scopeId) return "Global";
  switch (scopeType) {
    case "ORGANIZATION":
      return (await repositories.organizations.findById(scopeId))?.name ?? "Périmètre introuvable";
    case "COOPERATIVE":
      return (await repositories.cooperatives.findById(scopeId))?.name ?? "Périmètre introuvable";
    case "PRODUCER":
      return (await repositories.producers.findById(scopeId))?.name ?? "Périmètre introuvable";
    case "FARM":
      return (await repositories.farms.findById(scopeId))?.name ?? "Périmètre introuvable";
    default:
      return "—";
  }
}

export const createUserInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide.").max(200),
  fullName: z.string().trim().min(1, "Le nom est requis.").max(200),
  role: z.enum(ROLE),
  scopeType: z.enum(SCOPE_TYPE),
  scopeId: z.string().trim().min(1).optional().nullable(),
  password: z.string().min(8, "8 caractères minimum.").max(200),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export async function createUser(input: unknown, session: Session): Promise<User> {
  if (!can(session, "CREATE", "USERS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour créer un utilisateur.");
  }
  const parsed = createUserInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const existing = await repositories.users.findByEmail(data.email);
  if (existing) throw new ConflictError(`L'email "${data.email}" est déjà utilisé.`);

  const scopeId = data.scopeId ?? null;
  await assertScopeTargetExists(data.scopeType, scopeId);

  const user = await repositories.users.create({
    email: data.email,
    passwordHash: hashPassword(data.password),
    fullName: data.fullName,
    role: data.role,
    scopeType: data.scopeType,
    scopeId,
    active: true,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "user",
    entityId: user.id,
    field: null,
    oldValue: null,
    newValue: `${user.email} (${user.role})`,
    reason: "Création d'un utilisateur",
    relatedLotId: null,
    relatedEventId: null,
  });

  return user;
}

export async function updateUserRole(userId: string, role: Role, session: Session, reason?: string): Promise<User> {
  if (!can(session, "EDIT", "USERS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour modifier le rôle d'un utilisateur.");
  }
  const user = await getUserOrThrow(userId);
  if (user.role === role) return user;

  const updated = await repositories.users.update(userId, { role });

  await recordAudit({
    actorId: session.userId,
    entityType: "user",
    entityId: userId,
    field: "role",
    oldValue: user.role,
    newValue: role,
    reason: reason ?? null,
    relatedLotId: null,
    relatedEventId: null,
  });

  return updated;
}

export async function updateUserScope(
  userId: string,
  scopeType: ScopeType,
  scopeId: string | null,
  session: Session,
  reason?: string
): Promise<User> {
  if (!can(session, "EDIT", "USERS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour modifier le périmètre d'un utilisateur.");
  }
  const user = await getUserOrThrow(userId);
  const normalizedScopeId = scopeType === "GLOBAL" ? null : scopeId;
  if (user.scopeType === scopeType && user.scopeId === normalizedScopeId) return user;

  await assertScopeTargetExists(scopeType, normalizedScopeId);

  const updated = await repositories.users.update(userId, { scopeType, scopeId: normalizedScopeId });

  await recordAudit({
    actorId: session.userId,
    entityType: "user",
    entityId: userId,
    field: "scope",
    oldValue: JSON.stringify({ scopeType: user.scopeType, scopeId: user.scopeId }),
    newValue: JSON.stringify({ scopeType, scopeId: normalizedScopeId }),
    reason: reason ?? null,
    relatedLotId: null,
    relatedEventId: null,
  });

  return updated;
}

export async function setUserActive(userId: string, active: boolean, session: Session, reason?: string): Promise<User> {
  if (!can(session, "EDIT", "USERS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour activer/désactiver un utilisateur.");
  }
  if (userId === session.userId && !active) {
    throw new ConflictError("Vous ne pouvez pas désactiver votre propre compte.");
  }
  const user = await getUserOrThrow(userId);
  if (user.active === active) return user;

  const updated = await repositories.users.update(userId, { active });

  await recordAudit({
    actorId: session.userId,
    entityType: "user",
    entityId: userId,
    field: "active",
    oldValue: String(user.active),
    newValue: String(active),
    reason: reason ?? null,
    relatedLotId: null,
    relatedEventId: null,
  });

  return updated;
}
