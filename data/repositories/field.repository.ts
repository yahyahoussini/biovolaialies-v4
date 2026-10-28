import { and, desc, eq } from "drizzle-orm";
import type { FieldDiscrepancy, FieldDiscrepancyRepository, FieldEntry, FieldEntryRepository, NewFieldEntry } from "../../domain/field/field";
import { db } from "../db/client";
import { fieldDiscrepancies, fieldEntries } from "../db/schema";

const asEntry = (row: typeof fieldEntries.$inferSelect): FieldEntry => ({ ...row, payload: row.payload as Record<string, unknown> });

export class DrizzleFieldEntryRepository implements FieldEntryRepository {
  async findByOpId(opId: string): Promise<FieldEntry | null> {
    const row = await db.query.fieldEntries.findFirst({ where: eq(fieldEntries.opId, opId) });
    return row ? asEntry(row) : null;
  }

  async findByDeviceSeq(deviceId: string, seq: number): Promise<FieldEntry | null> {
    const row = await db.query.fieldEntries.findFirst({ where: and(eq(fieldEntries.deviceId, deviceId), eq(fieldEntries.deviceSeq, seq)) });
    return row ? asEntry(row) : null;
  }

  async create(input: NewFieldEntry): Promise<FieldEntry> {
    const [row] = await db.insert(fieldEntries).values(input).returning();
    return asEntry(row);
  }

  async listByDayKey(dayKey: string): Promise<FieldEntry[]> {
    const rows = await db.query.fieldEntries.findMany({ where: eq(fieldEntries.dayKey, dayKey), orderBy: (t, { asc }) => asc(t.capturedAt) });
    return rows.map(asEntry);
  }

  async listRecent(limit: number): Promise<FieldEntry[]> {
    const rows = await db.query.fieldEntries.findMany({ orderBy: (t) => desc(t.receivedAt), limit });
    return rows.map(asEntry);
  }

  async listByAuthor(authorId: string, limit: number): Promise<FieldEntry[]> {
    const rows = await db.query.fieldEntries.findMany({ where: eq(fieldEntries.authorId, authorId), orderBy: (t) => desc(t.receivedAt), limit });
    return rows.map(asEntry);
  }
}

export class DrizzleFieldDiscrepancyRepository implements FieldDiscrepancyRepository {
  async findById(id: string): Promise<FieldDiscrepancy | null> {
    return (await db.query.fieldDiscrepancies.findFirst({ where: eq(fieldDiscrepancies.id, id) })) ?? null;
  }

  async findByDayKey(dayKey: string): Promise<FieldDiscrepancy | null> {
    return (await db.query.fieldDiscrepancies.findFirst({ where: eq(fieldDiscrepancies.dayKey, dayKey) })) ?? null;
  }

  async open(input: { dayKey: string; lotId: string; day: string; reason: string; openedAt: string }): Promise<FieldDiscrepancy> {
    const [row] = await db
      .insert(fieldDiscrepancies)
      .values({ ...input, status: "OUVERT" })
      .onConflictDoUpdate({
        target: fieldDiscrepancies.dayKey,
        set: { status: "OUVERT", reason: input.reason, openedAt: input.openedAt, resolvedBy: null, resolvedAt: null, resolvedCount: null, resolutionNote: null },
      })
      .returning();
    return row;
  }

  async resolve(id: string, input: { resolvedBy: string; resolvedAt: string; resolvedCount: number; resolutionNote: string }): Promise<FieldDiscrepancy | null> {
    const [row] = await db
      .update(fieldDiscrepancies)
      .set({ status: "RESOLU", ...input })
      .where(and(eq(fieldDiscrepancies.id, id), eq(fieldDiscrepancies.status, "OUVERT")))
      .returning();
    return row ?? null;
  }

  async list(): Promise<FieldDiscrepancy[]> {
    return db.query.fieldDiscrepancies.findMany({ orderBy: (t) => desc(t.openedAt) });
  }
}
