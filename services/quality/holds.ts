import { z } from "zod";
import { repositories } from "../../data/repositories";
import {
  parseEvidenceRefs,
  validateDecision,
  type QualityCase,
  type QualityHoldItem,
} from "../../domain/quality/holds";
import { QUALITY_HOLD_SCOPE, QUALITY_REASON } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { isEntityType, type EntityType } from "../../domain/traceability/entity-types";
import { recordAudit } from "../audit/record";
import { appendLedgerEvent } from "../ledger/ledger";
import { rateLimit } from "../../lib/rate-limit";
import type { Session } from "../auth/session";
import { isWithinScope, resolveBuildingHierarchy, resolveLotHierarchy, type HierarchyPath } from "../identity/scope-check";
import { resolveNode, type ChainNode } from "../traceability/entity-resolver";
import { collectAncestors, collectDescendants } from "../traceability/genealogy";

/** Every object kind a hold can sit on. A destination is a place, not goods — it cannot be held. */
export function isHoldable(type: string): type is Exclude<EntityType, "DESTINATION"> {
  return isEntityType(type) && type !== "DESTINATION";
}

// ---------------------------------------------------------------------------
// The guard every derivation passes through
// ---------------------------------------------------------------------------

export async function activeHoldsOn(type: string, id: string): Promise<QualityHoldItem[]> {
  return repositories.qualityCases.listActiveItemsFor(type, id);
}

/**
 * Refuses to derive anything from a blocked object (rule R09: "blocage" means nothing leaves).
 * Called by every creation service *before* it writes, so a refusal never leaves a half-made
 * record behind.
 */
export async function assertNotOnHold(type: string, id: string): Promise<void> {
  const holds = await activeHoldsOn(type, id);
  if (holds.length === 0) return;
  const qualityCase = await repositories.qualityCases.findById(holds[0].caseId);
  throw new ConflictError(
    `Cet objet est sous blocage qualité (${qualityCase?.code ?? "dossier ouvert"}) : aucune opération en aval n'est possible avant sa levée.`
  );
}

// ---------------------------------------------------------------------------
// Scope: which part of the hierarchy an object belongs to
// ---------------------------------------------------------------------------

/**
 * Finds the hierarchy an object lives in by walking up to the first ancestor that sits in a
 * building — a farm lot, or an upstream object stored at a site. Returns null when none is
 * found; only a global-scope role may act on such an object.
 */
export async function resolveEntityHierarchy(type: EntityType, id: string): Promise<HierarchyPath | null> {
  const { nodes } = await collectAncestors(type, id);
  for (const node of nodes) {
    if (node.type === "LOT") return resolveLotHierarchy(node.id);
    const buildingId = await buildingOf(node.type, node.id);
    if (buildingId) return resolveBuildingHierarchy(buildingId);
  }
  return null;
}

async function buildingOf(type: EntityType, id: string): Promise<string | null> {
  switch (type) {
    case "PARENT_FLOCK":
      return (await repositories.parentFlocks.findById(id))?.buildingId ?? null;
    case "HATCH_CYCLE":
      return (await repositories.hatchCycles.findById(id))?.buildingId ?? null;
    case "EGG_LOT": {
      const egg = await repositories.eggLots.findById(id);
      if (!egg) return null;
      return egg.storageBuildingId ?? (await repositories.parentFlocks.findById(egg.parentFlockId))?.buildingId ?? null;
    }
    default:
      return null;
  }
}

async function assertEntityInScope(session: Session, type: EntityType, id: string): Promise<void> {
  if (isGlobalScope(session)) return;
  const path = await resolveEntityHierarchy(type, id);
  if (!path || !isWithinScope(session, path)) {
    throw new AuthorizationError("Cet objet n'appartient pas à votre périmètre.");
  }
}

// ---------------------------------------------------------------------------
// Opening a hold
// ---------------------------------------------------------------------------

export const openHoldInputSchema = z.object({
  rootType: z.string().refine(isHoldable, "Type d'objet non blocable."),
  rootId: z.string().min(1),
  reason: z.enum(QUALITY_REASON),
  description: z.string().trim().min(10, "Décrivez la cause du blocage (10 caractères minimum).").max(2000),
  scope: z.enum(QUALITY_HOLD_SCOPE),
  evidence: z.string().max(2000).default(""),
});

async function nextCaseCode(offset: number): Promise<string> {
  const year = new Date().getFullYear();
  const n = (await repositories.qualityCases.count()) + 1 + offset;
  return `QC-${year}-${String(n).padStart(3, "0")}`;
}

function isUniqueViolation(error: unknown): boolean {
  const text = `${(error as { message?: string })?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  return /UNIQUE constraint failed/i.test(text);
}

async function holdTargets(rootType: EntityType, rootId: string, scope: string) {
  return scope === "DESCENDANTS"
    ? (await collectDescendants(rootType, rootId)).nodes.filter((n) => isHoldable(n.type))
    : [{ type: rootType, id: rootId, depth: 0 }];
}

export async function openHold(input: unknown, session: Session): Promise<QualityCase> {
  if (!can(session, "CREATE", "QUALITY")) throw new AuthorizationError("Vous n'avez pas les droits pour ouvrir un blocage qualité.");
  const parsed = openHoldInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;
  const rootType = data.rootType as EntityType;

  const root = await resolveNode(rootType, data.rootId);
  if (!root) throw new NotFoundError(rootType, data.rootId);
  await assertEntityInScope(session, rootType, data.rootId);

  const targets = await holdTargets(rootType, data.rootId, data.scope);
  const createCase = async (offset: number) =>
    repositories.qualityCases.createWithItems(
      {
        code: await nextCaseCode(offset),
        rootType,
        rootId: data.rootId,
        reason: data.reason,
        description: data.description,
        scope: data.scope,
        status: "EN_BLOCAGE",
        evidenceRefs: parseEvidenceRefs(data.evidence),
        openedBy: session.userId,
        openedAt: new Date().toISOString(),
      },
      targets.map((t) => ({ objectType: t.type, objectId: t.id, depth: t.depth }))
    );

  // Two holds opened at the same instant can compute the same next code; the UNIQUE
  // constraint rejects the loser, which simply takes the following number.
  let created: QualityCase | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      created = await createCase(attempt);
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }
  if (!created) throw new ConflictError("Impossible d'attribuer un numéro de dossier. Réessayez.");

  // A derivation recorded between the genealogy walk and the insert would have passed the
  // guard before the hold existed. Walk again now that it does and block what was missed.
  if (data.scope === "DESCENDANTS") {
    const known = new Set(targets.map((t) => `${t.type}:${t.id}`));
    const missed = (await holdTargets(rootType, data.rootId, data.scope)).filter((t) => !known.has(`${t.type}:${t.id}`));
    await repositories.qualityCases.addItems(created.id, missed.map((t) => ({ objectType: t.type, objectId: t.id, depth: t.depth })));
    targets.push(...missed);
  }

  await recordAudit({
    actorId: session.userId,
    entityType: "quality_case",
    entityId: created.id,
    field: "status",
    oldValue: null,
    newValue: `EN_BLOCAGE — ${root.label}, ${targets.length} objet(s) bloqué(s)`,
    reason: `${data.reason} : ${data.description}`,
    relatedLotId: rootType === "LOT" ? data.rootId : null,
    relatedEventId: null,
  });

  return created;
}

// ---------------------------------------------------------------------------
// Deciding a hold: release, or confirm non-conformity
// ---------------------------------------------------------------------------

export const decideHoldInputSchema = z.object({
  caseId: z.string().min(1),
  decision: z.enum(["LIBERE", "NON_CONFORME"]),
  justification: z.string().max(4000),
  evidence: z.string().max(2000),
});

/**
 * Rule R10 / test T07: a refused release is itself evidence. Every refusal on an existing case
 * (wrong role, same person as the opener, missing justification or evidence) is written to the
 * chained ledger before the error goes back to the caller.
 */
async function journalRefusal(caseId: string, session: Session, reason: string): Promise<void> {
  if (!(await repositories.qualityCases.findById(caseId))) return;
  // Evidence, not a write amplifier: a few refusals per person and case per hour are kept.
  if (!rateLimit(`refusal:${session.userId}:${caseId}`, 3, 60 * 60 * 1000).allowed) return;
  await appendLedgerEvent({
    eventType: "QUALITY_DECISION_REFUSED",
    objectType: "quality_case",
    objectId: caseId,
    actorKind: "USER",
    actorId: session.userId,
    source: "application",
    occurredAt: new Date().toISOString(),
    payload: { role: session.role, reason },
  });
}

export async function decideHold(input: unknown, session: Session): Promise<QualityCase> {
  const caseId = typeof input === "object" && input !== null && "caseId" in input ? String((input as { caseId: unknown }).caseId) : "";
  if (!can(session, "VALIDATE", "QUALITY")) {
    await journalRefusal(caseId, session, "Rôle non habilité à décider.");
    throw new AuthorizationError("Seul un responsable qualité habilité peut lever ou confirmer un blocage.");
  }
  const parsed = decideHoldInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const existing = await repositories.qualityCases.findById(data.caseId);
  if (!existing) throw new NotFoundError("Dossier qualité", data.caseId);
  if (!(await inScope(session, existing))) {
    await journalRefusal(existing.id, session, "Dossier hors du périmètre du décideur.");
    throw new AuthorizationError("Ce dossier n'appartient pas à votre périmètre.");
  }

  const evidenceRefs = parseEvidenceRefs(data.evidence);
  const check = validateDecision(existing, session.userId, data.justification, evidenceRefs);
  if (!check.ok) {
    await journalRefusal(existing.id, session, check.error);
    throw new ValidationError(check.error);
  }

  const decided = await repositories.qualityCases.decide(existing.id, {
    status: data.decision,
    decidedBy: session.userId,
    decisionJustification: data.justification.trim(),
    decisionEvidenceRefs: evidenceRefs,
    decidedAt: new Date().toISOString(),
  });
  if (!decided) throw new ConflictError("Ce dossier vient d'être décidé par une autre personne. Rechargez la page.");

  await recordAudit({
    actorId: session.userId,
    entityType: "quality_case",
    entityId: existing.id,
    field: "status",
    oldValue: existing.status,
    newValue: data.decision,
    reason: `${data.justification.trim()} [preuves : ${evidenceRefs.join(", ")}]`,
    relatedLotId: existing.rootType === "LOT" ? existing.rootId : null,
    relatedEventId: null,
  });

  return decided;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface QualityCaseView {
  qualityCase: QualityCase;
  root: ChainNode | null;
  items: (QualityHoldItem & { node: ChainNode | null })[];
  openedByName: string;
  decidedByName: string | null;
}

async function inScope(session: Session, qualityCase: QualityCase): Promise<boolean> {
  if (isGlobalScope(session)) return true;
  if (!isEntityType(qualityCase.rootType)) return false;
  const path = await resolveEntityHierarchy(qualityCase.rootType, qualityCase.rootId);
  return path !== null && isWithinScope(session, path);
}

export async function listQualityCases(session: Session): Promise<(QualityCase & { rootLabel: string; itemCount: number })[]> {
  if (!can(session, "VIEW", "QUALITY")) throw new AuthorizationError();
  const cases = await repositories.qualityCases.list();
  const visible: (QualityCase & { rootLabel: string; itemCount: number })[] = [];
  for (const c of cases) {
    if (!(await inScope(session, c))) continue;
    const root = isEntityType(c.rootType) ? await resolveNode(c.rootType, c.rootId) : null;
    const items = await repositories.qualityCases.listItems(c.id);
    visible.push({ ...c, rootLabel: root?.label ?? `${c.rootType} ${c.rootId}`, itemCount: items.length });
  }
  return visible;
}

export async function getQualityCase(caseId: string, session: Session): Promise<QualityCaseView> {
  if (!can(session, "VIEW", "QUALITY")) throw new AuthorizationError();
  const qualityCase = await repositories.qualityCases.findById(caseId);
  if (!qualityCase) throw new NotFoundError("Dossier qualité", caseId);
  if (!(await inScope(session, qualityCase))) throw new AuthorizationError("Ce dossier n'appartient pas à votre périmètre.");

  const items = await repositories.qualityCases.listItems(caseId);
  const resolved = await Promise.all(
    items.map(async (item) => ({ ...item, node: isEntityType(item.objectType) ? await resolveNode(item.objectType, item.objectId) : null }))
  );
  const [opener, decider] = await Promise.all([
    repositories.users.findById(qualityCase.openedBy),
    qualityCase.decidedBy ? repositories.users.findById(qualityCase.decidedBy) : Promise.resolve(null),
  ]);

  return {
    qualityCase,
    root: isEntityType(qualityCase.rootType) ? await resolveNode(qualityCase.rootType, qualityCase.rootId) : null,
    items: resolved,
    openedByName: opener?.fullName ?? "—",
    decidedByName: decider?.fullName ?? null,
  };
}

/** Active holds on an object, with their case codes — for banners on lot/product pages. */
export async function describeActiveHolds(type: string, id: string): Promise<{ caseId: string; code: string }[]> {
  const items = await activeHoldsOn(type, id);
  const out: { caseId: string; code: string }[] = [];
  for (const caseId of new Set(items.map((i) => i.caseId))) {
    const c = await repositories.qualityCases.findById(caseId);
    if (c) out.push({ caseId, code: c.code });
  }
  return out;
}
