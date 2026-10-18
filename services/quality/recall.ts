import { repositories } from "../../data/repositories";
import { AuthorizationError, NotFoundError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { isEntityType, type EntityType } from "../../domain/traceability/entity-types";
import { ENTITY_TYPE_LABEL } from "../../lib/labels";
import type { Session } from "../auth/session";
import { isWithinScope } from "../identity/scope-check";
import { csvField } from "../leads/leads";
import { resolveNode, type ChainNode } from "../traceability/entity-resolver";
import { collectAncestors, collectDescendants } from "../traceability/genealogy";
import { resolveEntityHierarchy } from "./holds";

export interface RecallProduct {
  id: string;
  code: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  shipped: number;
  /** Packaged minus shipped — what is still on hand to withdraw. Null when the packaged quantity is unknown. */
  onHand: number | null;
}

export interface RecallShipment {
  code: string;
  productCode: string;
  destinationName: string;
  destinationCity: string;
  quantity: number;
  unit: string;
  shippedAt: string;
}

export interface RecallReport {
  root: ChainNode;
  computedAt: string;
  durationMs: number;
  /** Everything the root was made from — where to look for the cause. */
  upstream: (ChainNode & { depth: number })[];
  /** Everything made from the root — what has to be stopped or withdrawn. */
  downstream: (ChainNode & { depth: number })[];
  products: RecallProduct[];
  shipments: RecallShipment[];
  totals: { byUnit: { unit: string; packaged: number; shipped: number; onHand: number }[]; destinationCount: number };
  /** Gaps the report cannot close on its own, stated rather than hidden. */
  limits: string[];
}

/**
 * Upstream + downstream recall scope for one object (client spec A22, tests T03/T04/T13).
 * Built from the same relations graph as everything else; the report states explicitly what
 * it could not quantify instead of silently under-counting.
 */
export async function buildRecallReport(type: EntityType, id: string, session: Session): Promise<RecallReport> {
  if (!can(session, "VIEW", "QUALITY")) throw new AuthorizationError();
  const started = performance.now();
  const root = await resolveNode(type, id);
  if (!root) throw new NotFoundError(type, id);
  if (!isGlobalScope(session)) {
    const path = await resolveEntityHierarchy(type, id);
    if (!path || !isWithinScope(session, path)) throw new AuthorizationError("Cet objet n'appartient pas à votre périmètre.");
  }

  const [down, up] = await Promise.all([collectDescendants(type, id), collectAncestors(type, id)]);
  const resolveAll = async (nodes: { type: EntityType; id: string; depth: number }[]) =>
    (await Promise.all(nodes.filter((n) => n.depth > 0).map(async (n) => {
      const node = await resolveNode(n.type, n.id);
      return node ? { ...node, depth: n.depth } : null;
    }))).filter((n): n is ChainNode & { depth: number } => n !== null);

  const [downstream, upstream] = await Promise.all([resolveAll(down.nodes), resolveAll(up.nodes)]);
  const limits: string[] = [];
  if (down.truncated || up.truncated) limits.push("Le graphe dépasse la limite de parcours : le périmètre affiché est partiel.");

  const productIds = down.nodes.filter((n) => n.type === "PRODUCT").map((n) => n.id);
  const destinations = await repositories.destinations.list();
  const destinationById = new Map(destinations.map((d) => [d.id, d]));

  const products: RecallProduct[] = [];
  const shipments: RecallShipment[] = [];
  const destinationIds = new Set<string>(down.destinations.map((d) => d.id));
  for (const productId of productIds) {
    const product = await repositories.products.findById(productId);
    if (!product) continue;
    const productShipments = await repositories.shipments.listByProduct(productId);
    const shipped = productShipments.reduce((s, x) => s + x.quantity, 0);
    products.push({
      id: product.id,
      code: product.code,
      name: product.name,
      quantity: product.quantity,
      unit: product.unit,
      shipped,
      onHand: product.quantity === null ? null : product.quantity - shipped,
    });
    for (const s of productShipments) {
      const destination = destinationById.get(s.destinationId);
      destinationIds.add(s.destinationId);
      shipments.push({
        code: s.code,
        productCode: product.code,
        destinationName: destination?.name ?? "—",
        destinationCity: destination?.city ?? "—",
        quantity: s.quantity,
        unit: s.unit,
        shippedAt: s.shippedAt,
      });
    }
  }

  const missingQty = products.filter((p) => p.quantity === null).length;
  if (missingQty > 0) limits.push(`${missingQty} produit(s) sans quantité conditionnée enregistrée : le stock restant n'est pas chiffrable pour eux.`);
  // Only a product that points at a destination itself, with no shipment recording how much
  // went there, leaves a quantity gap. Destinations reached through shipments are quantified.
  let unquantifiedLinks = 0;
  for (const p of products) {
    if (p.shipped > 0) continue;
    const direct = (await repositories.relations.listFrom("PRODUCT", p.id)).some((r) => r.relationType === "DESTINE_A");
    if (direct) unquantifiedLinks += 1;
  }
  if (unquantifiedLinks > 0) {
    limits.push(`${unquantifiedLinks} produit(s) ont une destination connue sans expédition chiffrée : quantité livrée inconnue.`);
  }
  if (productIds.length === 0 && type !== "PRODUCT") limits.push("Aucun produit fini n'est encore issu de cet objet.");

  const byUnit = new Map<string, { unit: string; packaged: number; shipped: number; onHand: number }>();
  for (const p of products) {
    if (p.quantity === null || !p.unit) continue;
    const row = byUnit.get(p.unit) ?? { unit: p.unit, packaged: 0, shipped: 0, onHand: 0 };
    row.packaged += p.quantity;
    row.shipped += p.shipped;
    row.onHand += p.onHand ?? 0;
    byUnit.set(p.unit, row);
  }

  return {
    root,
    computedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    upstream: upstream.sort((a, b) => a.depth - b.depth),
    downstream: downstream.sort((a, b) => a.depth - b.depth),
    products,
    shipments: shipments.sort((a, b) => a.shippedAt.localeCompare(b.shippedAt)),
    totals: { byUnit: [...byUnit.values()], destinationCount: destinationIds.size },
    limits,
  };
}

export async function buildRecallReportForCase(caseId: string, session: Session): Promise<RecallReport> {
  const qualityCase = await repositories.qualityCases.findById(caseId);
  if (!qualityCase || !isEntityType(qualityCase.rootType)) throw new NotFoundError("Dossier qualité", caseId);
  return buildRecallReport(qualityCase.rootType, qualityCase.rootId, session);
}

export function recallReportToCsv(report: RecallReport, caseCode: string): string {
  const lines: string[] = [];
  const row = (...cells: (string | number | null)[]) => lines.push(cells.map((c) => csvField(c === null ? "" : String(c))).join(","));
  row("Dossier", caseCode);
  row("Objet", report.root.label);
  row("Calculé le", report.computedAt);
  lines.push("");
  row("Section", "Type", "Code", "Profondeur");
  for (const n of report.upstream) row("Amont", ENTITY_TYPE_LABEL[n.type], n.code, n.depth);
  for (const n of report.downstream) row("Aval", ENTITY_TYPE_LABEL[n.type], n.code, n.depth);
  lines.push("");
  row("Produit", "Désignation", "Conditionné", "Expédié", "En stock", "Unité");
  for (const p of report.products) row(p.code, p.name, p.quantity, p.shipped, p.onHand, p.unit);
  lines.push("");
  row("Expédition", "Produit", "Destination", "Ville", "Quantité", "Unité", "Date");
  for (const s of report.shipments) row(s.code, s.productCode, s.destinationName, s.destinationCity, s.quantity, s.unit, s.shippedAt);
  lines.push("");
  for (const limit of report.limits) row("Limite", limit);
  return "﻿" + lines.join("\r\n");
}
