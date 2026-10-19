import { repositories } from "../../data/repositories";
import { aggregateRange } from "./aggregate";

/**
 * After an occupation is recorded or closed, readings already received for that zone and period
 * are tied again to whichever lot the table now says was there (or to none), and their buckets
 * recomputed. Returns how many readings now belong to a lot.
 */
export async function reattributeReadings(zoneId: string, from: string, to: string | null): Promise<number> {
  const occupations = await repositories.zoneOccupations.listByZones([zoneId]);
  await repositories.readings.setAttribution(zoneId, from, to, null);
  let tied = 0;
  for (const o of occupations) {
    const start = o.startedAt > from ? o.startedAt : from;
    const ends = [o.endedAt, to].filter((v): v is string => v !== null);
    const end = ends.length ? ends.sort()[0] : null;
    if (end !== null && end <= start) continue;
    tied += await repositories.readings.setAttribution(zoneId, start, end, o.lotId);
  }
  const sensors = await repositories.telemetrySensors.listByZones([zoneId]);
  if (sensors.length) {
    const until = to ?? new Date().toISOString();
    // Buckets are rebuilt only where raw readings still exist (90 days); older buckets keep their lot.
    const floor = new Date(Date.now() - 90 * 86_400_000).toISOString();
    if (until > floor) await aggregateRange(from > floor ? from : floor, until, sensors.map((s) => s.id));
  }
  return tied;
}
