import { repositories } from "../../data/repositories";
import { isEntityType, type EntityType } from "../../domain/traceability/entity-types";
import { NotFoundError } from "../../domain/shared/errors";
import type { RelationType } from "../../domain/shared/enums";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { EVENT_TYPE_LABEL, summarizeEventPayload } from "../../lib/event-labels";
import { resolveNode, type ChainNode } from "./entity-resolver";

export interface ChainEdge {
  from: ChainNode;
  to: ChainNode;
  relationType: RelationType;
}

export interface UpstreamLink {
  label: string;
  name: string;
  href: string | null;
}

export interface TimelineEntry {
  timestamp: string;
  label: string;
  description: string | null;
  nodeType: EntityType | "LOT_EVENT";
  nodeId: string;
  dataStatus: string | null;
}

export interface TraceabilityChain {
  lot: ChainNode;
  upstream: UpstreamLink[];
  nodes: ChainNode[];
  edges: ChainEdge[];
  timeline: TimelineEntry[];
}

const MAX_NODES = 50; // safety cap — "avoid an unreadable giant graph" (phase-7 brief §11); comfortably above this MVP's actual chain sizes.

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Walks the generic `relations` table from a starting node. "Incoming" relations point TO a
 * node (its downstream dependents, since edges point "child → what it came from"); "outgoing"
 * ones are the node's own sources (or, for a product/shipment, its Destination).
 *
 * The walk is directional once it leaves the start: ancestors are followed only further up,
 * descendants only further down. Without that, two lots sharing an ancestor (two farm lots
 * hatched from the same parent flock) would leak into each other's chain — up to the flock,
 * then back down into the sibling's products. Destinations are collected from descendants but
 * never walked through.
 */
type Direction = "both" | "up" | "down";

async function walk(
  type: EntityType,
  id: string,
  nodesByKey: Map<string, ChainNode>,
  edges: ChainEdge[],
  visitedNodes: Set<string>,
  visitedEdges: Set<string>,
  direction: Direction = "both"
): Promise<void> {
  const nodeKey = key(type, id);
  if (visitedNodes.has(nodeKey) || nodesByKey.size > MAX_NODES) return;
  visitedNodes.add(nodeKey);

  const currentNode = nodesByKey.get(nodeKey);
  if (!currentNode) return;

  const [incoming, outgoing] = await Promise.all([
    direction === "up" ? Promise.resolve([]) : repositories.relations.listTo(type, id),
    repositories.relations.listFrom(type, id),
  ]);

  for (const rel of incoming) {
    if (!isEntityType(rel.fromType)) continue;
    const childKey = key(rel.fromType, rel.fromId);
    let childNode = nodesByKey.get(childKey);
    if (!childNode) {
      const resolved = await resolveNode(rel.fromType, rel.fromId);
      if (!resolved) continue;
      childNode = resolved;
      nodesByKey.set(childKey, childNode);
    }
    const edgeKey = `${rel.fromType}:${rel.fromId}>${rel.relationType}>${type}:${id}`;
    if (!visitedEdges.has(edgeKey)) {
      visitedEdges.add(edgeKey);
      edges.push({ from: childNode, to: currentNode, relationType: rel.relationType });
    }
    await walk(rel.fromType, rel.fromId, nodesByKey, edges, visitedNodes, visitedEdges, "down");
  }

  for (const rel of outgoing) {
    if (!isEntityType(rel.toType)) continue;
    // Going down, the only outgoing edge worth following is where the goods went.
    if (direction === "down" && rel.relationType !== "DESTINE_A") continue;
    const targetKey = key(rel.toType, rel.toId);
    let targetNode = nodesByKey.get(targetKey);
    if (!targetNode) {
      const resolved = await resolveNode(rel.toType, rel.toId);
      if (!resolved) continue;
      targetNode = resolved;
      nodesByKey.set(targetKey, targetNode);
    }
    const edgeKey = `${type}:${id}>${rel.relationType}>${rel.toType}:${rel.toId}`;
    if (!visitedEdges.has(edgeKey)) {
      visitedEdges.add(edgeKey);
      edges.push({ from: currentNode, to: targetNode, relationType: rel.relationType });
    }
    if (rel.relationType !== "DESTINE_A") {
      await walk(rel.toType, rel.toId, nodesByKey, edges, visitedNodes, visitedEdges, "up");
    }
  }
}

async function buildTimeline(lotId: string, nodes: ChainNode[]): Promise<TimelineEntry[]> {
  const events = await repositories.lotEvents.listByLot(lotId);
  const entries: TimelineEntry[] = events.map((event) => ({
    timestamp: event.occurredAt,
    label: EVENT_TYPE_LABEL[event.eventType],
    description: summarizeEventPayload(event.eventType, event.payload),
    nodeType: "LOT_EVENT",
    nodeId: event.id,
    dataStatus: event.dataStatus,
  }));

  for (const node of nodes) {
    if (node.type === "LOT" || node.type === "DESTINATION" || !node.occurredAt) continue;
    entries.push({
      timestamp: node.occurredAt,
      label: node.label,
      description: null,
      nodeType: node.type,
      nodeId: node.id,
      dataStatus: node.dataStatus,
    });
  }

  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * The lot's upstream story using ONLY structural data that already exists (Producer → Farm →
 * Building), never a fabricated hatchery/genetics/feed-lot record (phase-7 brief §3).
 */
async function buildUpstream(buildingId: string): Promise<UpstreamLink[]> {
  const building = await repositories.buildings.findById(buildingId);
  if (!building) return [];
  const farm = await repositories.farms.findById(building.farmId);
  if (!farm) return [{ label: "Bâtiment", name: `${building.code} — ${building.name}`, href: null }];
  const producer = await repositories.producers.findById(farm.producerId);

  const links: UpstreamLink[] = [];
  if (producer) links.push({ label: "Producteur", name: producer.name, href: `/producteurs/${producer.id}` });
  links.push({ label: "Ferme", name: farm.name, href: `/fermes/${farm.id}` });
  links.push({ label: "Bâtiment", name: `${building.code} — ${building.name}`, href: `/fermes/${farm.id}/batiments/${building.id}` });
  return links;
}

export async function buildLotTraceabilityChain(lotId: string, session: Session): Promise<TraceabilityChain> {
  assertInScope(session, await resolveLotHierarchy(lotId));

  const lot = await repositories.lots.findById(lotId);
  if (!lot) throw new NotFoundError("LOT", lotId);
  const lotNode = await resolveNode("LOT", lotId);
  if (!lotNode) throw new NotFoundError("LOT", lotId);

  const nodesByKey = new Map<string, ChainNode>([[key("LOT", lotId), lotNode]]);
  const edges: ChainEdge[] = [];
  await walk("LOT", lotId, nodesByKey, edges, new Set(), new Set());

  const nodes = Array.from(nodesByKey.values());
  const [upstream, timeline] = await Promise.all([buildUpstream(lot.buildingId), buildTimeline(lotId, nodes)]);

  return { lot: lotNode, upstream, nodes, edges, timeline };
}
