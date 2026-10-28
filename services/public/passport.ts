import { repositories } from "../../data/repositories";
import { isEntityType, type EntityType } from "../../domain/traceability/entity-types";
import type { PublicLineageStage, PublicPassport, PublicTimelineEntry, Product } from "../../domain/traceability/types";
import type { Lot } from "../../domain/production/types";
import type { DataStatus, LotStatus } from "../../domain/shared/enums";
import { assignBvuId } from "../identity/bvu-ids";
import { activeHoldsOn } from "../quality/holds";
import { resolveNode, type ChainNode } from "../traceability/entity-resolver";

/**
 * The ONLY place that decides what a scanned QR code is allowed to show (phase-9 brief §3).
 * The public route calls this and nothing else — it never touches a repository directly.
 * Returns null for anything that should read as "not found": missing token, revoked, expired,
 * or a target that no longer resolves. The caller (app/(public)/tracabilite/[token]/page.tsx)
 * turns null into a 404 — a revoked/expired/invalid token must be indistinguishable from a
 * token that never existed, so scanning around for "still valid" tokens gains an attacker nothing.
 */
export async function resolvePublicPassport(token: string): Promise<PublicPassport | null> {
  if (!token || token.length < 10) return null;

  const qrToken = await repositories.qrTokens.findByToken(token);
  if (!qrToken) return null;
  if (!qrToken.active) return null;
  if (qrToken.expiresAt && new Date(qrToken.expiresAt).getTime() < Date.now()) return null;
  if (!qrToken.lotId) return null;

  const lot = await repositories.lots.findById(qrToken.lotId);
  if (!lot) return null;
  const building = await repositories.buildings.findById(lot.buildingId);
  if (!building) return null;
  const farm = await repositories.farms.findById(building.farmId);
  if (!farm) return null;

  const product = qrToken.scope === "PRODUCT" && qrToken.productId ? await repositories.products.findById(qrToken.productId) : null;
  if (qrToken.scope === "PRODUCT" && !product) return null;

  const downstream = await walkDownstream("LOT", lot.id);
  const { timeline, lineage } = buildTimelineAndLineage(lot, farm.name, farm.city, downstream, product);

  const statusResult =
    qrToken.scope === "PRODUCT" && product ? resolveProductStatus(product, lot) : resolveLotStatus(lot.status);
  const qualityHold =
    (product ? (await activeHoldsOn("PRODUCT", product.id)).length > 0 : false) || (await activeHoldsOn("LOT", lot.id)).length > 0;
  const { label: publicStatus, verified } = qualityHold
    ? { label: "Retenu par le contrôle qualité — vérification en cours.", verified: false }
    : statusResult;
  const geneticOrigin = await resolvePublicGeneticOrigin(lot.id);

  return {
    scope: qrToken.scope,
    productName: product?.name ?? null,
    publicProductCode: product?.code ?? null,
    bvuId: product ? await assignBvuId("PRODUCT", product.id) : await assignBvuId("LOT", lot.id),
    lotCode: lot.code,
    originFarmName: farm.name,
    originCity: farm.city,
    period: { start: lot.startedAt ?? lot.plannedStartAt, end: lot.endedAt },
    publicStatus,
    verified,
    certifications: [], // no certification/document management exists in this MVP (phase-8 T12 finding) — never fabricated
    timeline,
    lineage,
    isDemoData: !isRealOrValidated(product?.dataStatus ?? lot.dataStatus),
    qualityHold,
    geneticOrigin,
  };
}

/**
 * The upstream facts a consumer may see: the strain and the hatchery's city. Never supplier
 * names, import references or internal codes (rule R11: only approved public fields).
 */
async function resolvePublicGeneticOrigin(lotId: string): Promise<string | null> {
  const chickEdge = (await repositories.relations.listFrom("LOT", lotId)).find((r) => r.toType === "CHICK_LOT");
  if (!chickEdge) return null;
  const chicks = await repositories.chickLots.findById(chickEdge.toId);
  if (!chicks) return null;
  const cycle = await repositories.hatchCycles.findById(chicks.hatchCycleId);
  if (!cycle) return null;
  const hatcheryBuilding = await repositories.buildings.findById(cycle.buildingId);
  const hatcheryFarm = hatcheryBuilding ? await repositories.farms.findById(hatcheryBuilding.farmId) : null;
  const eggEdge = (await repositories.relations.listFrom("HATCH_CYCLE", cycle.id)).find((r) => r.toType === "EGG_LOT");
  const egg = eggEdge ? await repositories.eggLots.findById(eggEdge.toId) : null;
  const flock = egg ? await repositories.parentFlocks.findById(egg.parentFlockId) : null;
  const parts = [flock ? `Souche ${flock.strain.replace(/\s+PS$/i, "")}` : null, hatcheryFarm ? `couvoir à ${hatcheryFarm.city}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function isRealOrValidated(status: DataStatus): boolean {
  return status === "REEL" || status === "VALIDE";
}

const PUBLIC_LOT_STATUS: Record<LotStatus, { label: string; verified: boolean }> = {
  PLANIFIE: { label: "En préparation", verified: false },
  CREE: { label: "En préparation", verified: false },
  ACTIF: { label: "En cours de production", verified: false },
  EN_TRANSFERT: { label: "En transfert", verified: false },
  SUSPENDU: { label: "Suspendu — accès restreint", verified: false },
  BLOQUE: { label: "Bloqué — non vérifié", verified: false },
  LIBERE: { label: "Vérifié et libéré", verified: true },
  ABATTU: { label: "Abattu — en transformation", verified: false },
  TRANSFORME: { label: "Transformé", verified: false },
  CLOTURE: { label: "Cycle clôturé", verified: false },
  ARCHIVE: { label: "Archivé", verified: false },
};

function resolveLotStatus(status: LotStatus): { label: string; verified: boolean } {
  return PUBLIC_LOT_STATUS[status];
}

/**
 * A product's own status never overrides a blocked/suspended origin lot (phase-8's
 * BLOCKED_SOURCE_DOWNSTREAM concern, applied here to what the public ever sees) — a released
 * product can't read as verified if its source has since been restricted.
 */
function resolveProductStatus(product: Product, lot: Lot): { label: string; verified: boolean } {
  if (lot.status === "BLOQUE" || lot.status === "SUSPENDU") {
    return { label: "Restreint — non vérifié", verified: false };
  }
  if (isRealOrValidated(product.dataStatus)) {
    return { label: "Vérifié", verified: true };
  }
  return { label: "En attente de validation", verified: false };
}

const STAGE_LABEL: Partial<Record<EntityType, string>> = {
  COLLECTION: "Collecte",
  SLAUGHTER_BATCH: "Abattage",
  TRANSFORMATION_BATCH: "Transformation",
  PRODUCT: "Conditionnement",
};

const MAX_DOWNSTREAM_NODES = 50;

/**
 * Downstream-only walk from the lot (public passports never need the upstream/bidirectional
 * graph internal pages use) — reuses the same `relations` table and resolveNode() the internal
 * chain builder uses, but intentionally does NOT reuse buildLotTraceabilityChain() itself: that
 * function requires an authenticated Session (it scope-checks via assertInScope), which the
 * public route has none of. `listTo(type, id)` returns edges declaring `id` as their source
 * (e.g. COLLECTION -COLLECTE_DE-> LOT), i.e. exactly this node's downstream dependents.
 */
async function walkDownstream(type: EntityType, id: string, visited: Set<string> = new Set()): Promise<ChainNode[]> {
  const key = `${type}:${id}`;
  if (visited.has(key) || visited.size > MAX_DOWNSTREAM_NODES) return [];
  visited.add(key);

  const children = await repositories.relations.listTo(type, id);
  const nodes: ChainNode[] = [];
  for (const rel of children) {
    if (!isEntityType(rel.fromType) || rel.fromType === "DESTINATION") continue;
    const node = await resolveNode(rel.fromType, rel.fromId);
    if (!node) continue;
    nodes.push(node);
    nodes.push(...(await walkDownstream(rel.fromType, rel.fromId, visited)));
  }
  return nodes;
}

function buildTimelineAndLineage(
  lot: Lot,
  farmName: string,
  farmCity: string,
  downstream: ChainNode[],
  focalProduct: Product | null
): { timeline: PublicTimelineEntry[]; lineage: PublicLineageStage[] } {
  const timeline: PublicTimelineEntry[] = [
    {
      label: "Origine",
      description: `Élevage démarré — ${farmName}, ${farmCity}`,
      date: lot.startedAt ?? lot.plannedStartAt,
      verified: Boolean(lot.startedAt),
    },
  ];

  const presentStageTypes = new Set(downstream.map((n) => n.type));
  const sortedDownstream = [...downstream].sort((a, b) => new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime());
  for (const node of sortedDownstream) {
    const label = STAGE_LABEL[node.type];
    if (!label) continue;
    timeline.push({
      label,
      description: null,
      date: node.occurredAt || null,
      verified: node.dataStatus === "REEL" || node.dataStatus === "VALIDE",
    });
  }

  const finalStatus = resolveLotStatus(lot.status);
  timeline.push({
    label: "Statut actuel",
    description: finalStatus.label,
    date: null,
    verified: finalStatus.verified,
  });

  const lineage: PublicLineageStage[] = [
    { label: "Origine", name: `${farmName}, ${farmCity}` },
    { label: "Lot", name: lot.code },
  ];
  if (presentStageTypes.has("COLLECTION")) lineage.push({ label: "Étape", name: "Collecte" });
  if (presentStageTypes.has("SLAUGHTER_BATCH")) lineage.push({ label: "Étape", name: "Abattage" });
  if (presentStageTypes.has("TRANSFORMATION_BATCH")) lineage.push({ label: "Étape", name: "Transformation" });
  if (focalProduct) lineage.push({ label: "Produit", name: focalProduct.name });

  return { timeline, lineage };
}
