import { Activity } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { EVENT_TYPE_LABEL, summarizeEventPayload } from "@/lib/event-labels";
import type { DashboardEvent } from "@/services/dashboard/types";

/** The dashboard's bottom "Activité récente" feed (phase-5 brief §9) — real lot_events, nothing generated in the component. */
export function ActivityFeed({ events }: { events: DashboardEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Aucune activité"
        description="Aucun événement enregistré dans ce périmètre pour la période sélectionnée."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => {
        const summary = summarizeEventPayload(event.eventType, event.payload);
        return (
          <li key={event.id} className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text">{EVENT_TYPE_LABEL[event.eventType]}</span>
                <Link href={`/lots/${event.lotId}`} className="focus-ring text-xs font-medium text-bio-green hover:underline">
                  {event.lotCode}
                </Link>
              </div>
              {summary ? <p className="text-xs text-secondary">{summary}</p> : null}
              <p className="text-xs text-secondary">
                {event.actorName} · {event.farmName} · {event.buildingCode}
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-secondary">
              {new Date(event.occurredAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
