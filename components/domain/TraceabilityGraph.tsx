import { Bird, Box, Egg, Factory, Flame, MapPin, Package, Scissors, Send, Truck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import type { EntityType } from "@/domain/traceability/entity-types";
import { ENTITY_TYPE_LABEL, RELATION_TYPE_LABEL } from "@/lib/labels";
import type { ChainEdge } from "@/services/traceability/chain";
import type { ChainNode } from "@/services/traceability/entity-resolver";

const NODE_ICON: Record<EntityType, LucideIcon> = {
  PARENT_FLOCK: Users,
  EGG_LOT: Egg,
  HATCH_CYCLE: Flame,
  CHICK_LOT: Bird,
  SHIPMENT: Send,
  LOT: Box,
  COLLECTION: Truck,
  SLAUGHTER_BATCH: Scissors,
  TRANSFORMATION_BATCH: Factory,
  PRODUCT: Package,
  DESTINATION: MapPin,
};

function sortForDisplay(nodes: ChainNode[]): ChainNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.occurredAt && !b.occurredAt) return 0;
    if (!a.occurredAt) return 1;
    if (!b.occurredAt) return -1;
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  });
}

function findEdge(edges: ChainEdge[], a: ChainNode, b: ChainNode): ChainEdge | null {
  return edges.find((e) => (e.from.id === a.id && e.to.id === b.id) || (e.from.id === b.id && e.to.id === a.id)) ?? null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The lineage graph (phase-7 brief §10-§11) — a numbered vertical flow, not a force-directed
 * diagram library: this MVP's chains are short and effectively linear, so a stacked list
 * with a continuous rail reads better than a general-purpose graph canvas would. Only
 * relationships that actually exist in the database are shown — nothing hardcoded.
 *
 * The stage rail carries the reading order (§9: "where did it come from / what happened /
 * what did it become" at a glance): a single connector line runs the length of the chain,
 * each step is numbered, and the edge caption sits *on* the connector rather than floating
 * between two cards where it used to read as unattached.
 */
export function TraceabilityGraph({
  nodes,
  edges,
  currentNodeId,
}: {
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** The lot being viewed — marked "Ce lot" so the user can locate themselves in the chain. */
  currentNodeId?: string;
}) {
  const ordered = sortForDisplay(nodes);

  return (
    <ol className="flex flex-col">
      {ordered.map((node, index) => {
        const previous = ordered[index - 1];
        const edge = previous ? findEdge(edges, previous, node) : null;
        const Icon = NODE_ICON[node.type];
        const isLast = index === ordered.length - 1;
        const isCurrent = node.id === currentNodeId;

        return (
          <li key={`${node.type}:${node.id}`} id={`node-${node.type}-${node.id}`} className="relative flex gap-3 sm:gap-4">
            {/* Rail: numbered marker + the connector down to the next stage. */}
            <div className="flex w-8 shrink-0 flex-col items-center sm:w-9">
              <span
                className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-caption font-bold sm:size-9 ${
                  isCurrent
                    ? "border-bio-green bg-bio-green text-white"
                    : "border-border bg-surface text-secondary"
                }`}
              >
                {index + 1}
              </span>
              {!isLast ? <span className="w-px flex-1 bg-border" aria-hidden="true" /> : null}
            </div>

            <div className={`flex min-w-0 flex-1 flex-col ${isLast ? "pb-0" : "pb-5"}`}>
              {edge ? (
                <p className="-mt-0.5 mb-1.5 text-caption text-secondary">
                  {RELATION_TYPE_LABEL[edge.relationType]} l&apos;étape {index}
                </p>
              ) : null}

              <NodeCard node={node} Icon={Icon} isCurrent={isCurrent} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function NodeCard({ node, Icon, isCurrent }: { node: ChainNode; Icon: LucideIcon; isCurrent: boolean }) {
  const content = (
    <div
      className={`flex w-full items-start gap-3 rounded-lg border bg-surface px-4 py-3 transition-[border-color,box-shadow] ${
        isCurrent ? "border-bio-green/60 shadow-sm" : "border-border"
      } ${node.href ? "group-hover:border-bio-green/60 group-hover:shadow-sm group-focus-visible:border-bio-green" : ""}`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md ${
          isCurrent ? "bg-bio-green/10 text-bio-green" : "bg-background text-secondary"
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-card-title">{node.code}</span>
          {isCurrent ? (
            <span className="rounded-full bg-bio-green/10 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-deep-green">
              Ce lot
            </span>
          ) : null}
        </div>
        <span className="text-caption text-secondary">
          {ENTITY_TYPE_LABEL[node.type]}
          {node.occurredAt ? ` · ${formatDate(node.occurredAt)}` : ""}
        </span>
      </div>

      {node.dataStatus ? <DataStatusBadge status={node.dataStatus} className="mt-0.5 shrink-0" /> : null}
    </div>
  );

  // Nodes without a route (destinations) are not links — the old markup wrapped them in an
  // anchor to their own `#id`, which looked interactive but navigated nowhere.
  if (!node.href) return content;

  return (
    <Link href={node.href} className="focus-ring group block rounded-lg">
      {content}
    </Link>
  );
}
