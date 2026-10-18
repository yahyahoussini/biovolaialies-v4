import { repositories } from "../../data/repositories";
import { isEntityType, type EntityType } from "../../domain/traceability/entity-types";

export interface GenealogyNode {
  type: EntityType;
  id: string;
  /** Number of edges from the starting object. */
  depth: number;
}

/** Hard cap so a malformed graph can never turn a recall into an unbounded walk. */
const MAX_NODES = 5000;

/**
 * Edges point from the derived object to its source ("PRODUCT CONDITIONNE_DEPUIS
 * TRANSFORMATION_BATCH"). So descendants are found by following edges *into* a node, ancestors
 * by following edges *out of* it. DESTINE_A is the one edge that does not mean "made from":
 * a destination is where goods went, not something derived from them. It is collected
 * separately (destinations reached) and never walked through.
 */
async function walk(
  start: { type: EntityType; id: string },
  direction: "down" | "up"
): Promise<{ nodes: GenealogyNode[]; destinations: GenealogyNode[]; truncated: boolean }> {
  const seen = new Set<string>([`${start.type}:${start.id}`]);
  const nodes: GenealogyNode[] = [{ ...start, depth: 0 }];
  const destinations = new Map<string, GenealogyNode>();
  const queue: GenealogyNode[] = [{ ...start, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges =
      direction === "down"
        ? (await repositories.relations.listTo(current.type, current.id)).map((r) => ({ type: r.fromType, id: r.fromId, rel: r.relationType }))
        : (await repositories.relations.listFrom(current.type, current.id)).map((r) => ({ type: r.toType, id: r.toId, rel: r.relationType }));

    if (direction === "down") {
      for (const out of await repositories.relations.listFrom(current.type, current.id)) {
        if (out.relationType === "DESTINE_A" && isEntityType(out.toType)) {
          destinations.set(out.toId, { type: out.toType, id: out.toId, depth: current.depth + 1 });
        }
      }
    }

    for (const edge of edges) {
      if (edge.rel === "DESTINE_A" || !isEntityType(edge.type)) continue;
      const key = `${edge.type}:${edge.id}`;
      if (seen.has(key)) continue;
      if (seen.size >= MAX_NODES) {
        truncated = true;
        break;
      }
      seen.add(key);
      const node = { type: edge.type, id: edge.id, depth: current.depth + 1 };
      nodes.push(node);
      queue.push(node);
    }
  }

  return { nodes, destinations: [...destinations.values()], truncated };
}

/** The object itself (depth 0) and everything made from it, plus where those goods were sent. */
export function collectDescendants(type: EntityType, id: string) {
  return walk({ type, id }, "down");
}

/** The object itself (depth 0) and everything it was made from. */
export async function collectAncestors(type: EntityType, id: string) {
  const { nodes, truncated } = await walk({ type, id }, "up");
  return { nodes, truncated };
}
