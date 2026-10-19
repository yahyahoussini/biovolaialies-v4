import type { ReadingAttribution } from "../shared/enums";
import type { ZoneOccupation } from "./types";

/**
 * The occupation table answers one question: which lot was in this zone at this instant?
 * (document 3, ch. 2). An interval is [startedAt, endedAt) — the instant a lot leaves belongs
 * to whoever comes in next, never to both.
 */

function covers(o: Pick<ZoneOccupation, "startedAt" | "endedAt">, at: number): boolean {
  return Date.parse(o.startedAt) <= at && (o.endedAt === null || at < Date.parse(o.endedAt));
}

export interface Occupant {
  lotId: string | null;
  attribution: ReadingAttribution;
}

/**
 * Two lots in the same zone at the same time cannot be told apart by a sensor: the reading is
 * kept but tied to no lot, and marked AMBIGU, rather than credited to one of them at random.
 */
export function occupantAt(occupations: ZoneOccupation[], zoneId: string | null, at: string): Occupant {
  if (!zoneId) return { lotId: null, attribution: "AUCUN_LOT" };
  const t = Date.parse(at);
  const present = occupations.filter((o) => o.zoneId === zoneId && covers(o, t));
  if (present.length === 0) return { lotId: null, attribution: "AUCUN_LOT" };
  const lots = new Set(present.map((o) => o.lotId));
  if (lots.size > 1) return { lotId: null, attribution: "AMBIGU" };
  return { lotId: present[0].lotId, attribution: "OCCUPATION" };
}

/** Returns the occupation the new one would overlap in the same zone, if any. */
export function findOverlap(
  existing: ZoneOccupation[],
  candidate: Pick<ZoneOccupation, "zoneId" | "startedAt" | "endedAt" | "lotId">
): ZoneOccupation | null {
  const start = Date.parse(candidate.startedAt);
  const end = candidate.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(candidate.endedAt);
  for (const o of existing) {
    if (o.zoneId !== candidate.zoneId) continue;
    const oStart = Date.parse(o.startedAt);
    const oEnd = o.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(o.endedAt);
    if (start < oEnd && oStart < end) return o;
  }
  return null;
}
