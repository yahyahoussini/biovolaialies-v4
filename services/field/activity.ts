import { repositories } from "../../data/repositories";
import { CORRECTION_WINDOW_DAYS, type FieldDiscrepancy, type FieldEntry } from "../../domain/field/field";
import { isGlobalScope } from "../../domain/shared/scope";
import { AuthorizationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import type { Session } from "../auth/session";
import { buildHierarchyIndex, isWithinScope } from "../identity/scope-check";

/**
 * The office side of the field app: what reached the server from the phones, what was refused and
 * why, and the days whose mortality declarations disagree — each with every declaration kept, and
 * the arbitration open to a manager (document 3, ch. 05 and annex).
 */

export interface FieldEntryRow extends FieldEntry {
  lotCode: string | null;
  authorName: string;
}

export interface DiscrepancyRow extends FieldDiscrepancy {
  lotCode: string;
  farmName: string;
  declarations: { authorName: string; count: number; capturedAt: string; status: FieldEntry["status"] }[];
  applied: number;
  canResolve: boolean;
  /** Past the correction window, only the administrator may arbitrate (annex: "jusqu'à quand"). */
  windowClosed: boolean;
}

export interface FieldActivity {
  entries: FieldEntryRow[];
  discrepancies: DiscrepancyRow[];
  stats: { receivedToday: number; refusedWeek: number; openDiscrepancies: number };
}

export async function getFieldActivity(session: Session, now = new Date()): Promise<FieldActivity> {
  if (!can(session, "VIEW", "EVENTS")) throw new AuthorizationError();
  const [entries, discrepancies, lots, users, index, buildings, farms] = await Promise.all([
    repositories.fieldEntries.listRecent(500),
    repositories.fieldDiscrepancies.list(),
    repositories.lots.list(),
    repositories.users.list(),
    buildHierarchyIndex(),
    repositories.buildings.list(),
    repositories.farms.list(),
  ]);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const farmOfBuilding = new Map(buildings.map((b) => [b.id, farms.find((f) => f.id === b.farmId)?.name ?? "—"]));
  const inScope = (lotId: string | null) => {
    if (isGlobalScope(session)) return true;
    const lot = lotId ? lotById.get(lotId) : undefined;
    return !!lot && isWithinScope(session, index.building.get(lot.buildingId) ?? {});
  };

  // Entries without a lot (receptions) are shown to the person who made them and to global roles.
  const visible = entries.filter((e) => (e.lotId ? inScope(e.lotId) : isGlobalScope(session) || e.authorId === session.userId));
  const rows: FieldEntryRow[] = visible.slice(0, 200).map((e) => ({ ...e, lotCode: e.lotId ? (lotById.get(e.lotId)?.code ?? null) : null, authorName: nameOf.get(e.authorId) ?? "—" }));

  const canResolve = can(session, "VALIDATE", "EVENTS");
  const discrepancyRows: DiscrepancyRow[] = [];
  for (const d of discrepancies.filter((x) => inScope(x.lotId))) {
    const dayEntries = (await repositories.fieldEntries.listByDayKey(d.dayKey)).filter((e) => e.status !== "REFUSEE");
    const lot = lotById.get(d.lotId);
    const windowClosed = (now.getTime() - Date.parse(`${d.day}T12:00:00Z`)) / 86_400_000 > CORRECTION_WINDOW_DAYS;
    discrepancyRows.push({
      ...d,
      lotCode: lot?.code ?? "—",
      farmName: lot ? (farmOfBuilding.get(lot.buildingId) ?? "—") : "—",
      declarations: dayEntries.map((e) => ({ authorName: nameOf.get(e.authorId) ?? "—", count: (e.payload as { count: number }).count, capturedAt: e.capturedAt, status: e.status })),
      applied: dayEntries.reduce((sum, e) => sum + e.appliedCount, 0),
      canResolve: canResolve && d.status === "OUVERT" && (!windowClosed || session.role === "SUPER_ADMIN"),
      windowClosed,
    });
  }

  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  return {
    entries: rows,
    discrepancies: discrepancyRows.sort((a, b) => (a.status === b.status ? b.openedAt.localeCompare(a.openedAt) : a.status === "OUVERT" ? -1 : 1)),
    stats: {
      receivedToday: visible.filter((e) => e.receivedAt.slice(0, 10) === today).length,
      refusedWeek: visible.filter((e) => e.status === "REFUSEE" && e.receivedAt >= weekAgo).length,
      openDiscrepancies: discrepancyRows.filter((d) => d.status === "OUVERT").length,
    },
  };
}
