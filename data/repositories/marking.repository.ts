import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import type {
  CodeBlock,
  EggExceptionKind,
  EggReadException,
  EggTray,
  MarkingLine,
  MarkingRepository,
  MarkingRun,
  MarkingRunStatus,
  MarkingSourceType,
  NewMarkingLine,
  NewMarkingRun,
  ReadBatch,
  ReadStop,
  SerialRange,
} from "../../domain/marking/marking";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "../db/client";
import { eggCodeBlocks, eggMarkingLines, eggMarkingRuns, eggReadBatches, eggReadExceptions, eggReadStops, eggTrays } from "../db/schema";

const overlapping = (t: { firstSerial: AnySQLiteColumn; lastSerial: AnySQLiteColumn }, range: SerialRange) =>
  and(lte(t.firstSerial, range.lastSerial), gte(t.lastSerial, range.firstSerial));

export class DrizzleMarkingRepository implements MarkingRepository {
  async listLines(): Promise<MarkingLine[]> {
    return db.query.eggMarkingLines.findMany({ orderBy: (t) => asc(t.code) });
  }

  async findLine(id: string): Promise<MarkingLine | null> {
    return (await db.query.eggMarkingLines.findFirst({ where: eq(eggMarkingLines.id, id) })) ?? null;
  }

  async findLineByCode(code: string): Promise<MarkingLine | null> {
    return (await db.query.eggMarkingLines.findFirst({ where: eq(eggMarkingLines.code, code) })) ?? null;
  }

  async findLineByPrefix(prefix: string): Promise<MarkingLine | null> {
    return (await db.query.eggMarkingLines.findFirst({ where: eq(eggMarkingLines.shellPrefix, prefix) })) ?? null;
  }

  async createLine(input: NewMarkingLine): Promise<MarkingLine> {
    const [row] = await db.insert(eggMarkingLines).values(input).returning();
    return row;
  }

  async updateLine(id: string, changes: Parameters<MarkingRepository["updateLine"]>[1]): Promise<MarkingLine> {
    const [row] = await db.update(eggMarkingLines).set(changes).where(eq(eggMarkingLines.id, id)).returning();
    return row;
  }

  async advanceSerial(lineId: string, expectedNext: number, count: number): Promise<MarkingLine | null> {
    const [row] = await db
      .update(eggMarkingLines)
      .set({ nextSerial: expectedNext + count })
      .where(and(eq(eggMarkingLines.id, lineId), eq(eggMarkingLines.nextSerial, expectedNext)))
      .returning();
    return row ?? null;
  }

  async listRuns(): Promise<MarkingRun[]> {
    return db.query.eggMarkingRuns.findMany({ orderBy: (t) => desc(t.startedAt) });
  }

  async listRunsByLine(lineId: string): Promise<MarkingRun[]> {
    return db.query.eggMarkingRuns.findMany({ where: eq(eggMarkingRuns.lineId, lineId), orderBy: (t) => desc(t.startedAt) });
  }

  async listRunsBySource(sourceType: MarkingSourceType, sourceIds: string[]): Promise<MarkingRun[]> {
    if (sourceIds.length === 0) return [];
    return db.query.eggMarkingRuns.findMany({
      where: and(eq(eggMarkingRuns.sourceType, sourceType), inArray(eggMarkingRuns.sourceId, sourceIds)),
      orderBy: (t) => asc(t.startedAt),
    });
  }

  async findRun(id: string): Promise<MarkingRun | null> {
    return (await db.query.eggMarkingRuns.findFirst({ where: eq(eggMarkingRuns.id, id) })) ?? null;
  }

  async findOpenRun(lineId: string): Promise<MarkingRun | null> {
    return (
      (await db.query.eggMarkingRuns.findFirst({
        where: and(eq(eggMarkingRuns.lineId, lineId), or(eq(eggMarkingRuns.status, "EN_COURS"), eq(eggMarkingRuns.status, "ARRET_LECTURE"))),
      })) ?? null
    );
  }

  async findRunBySerial(lineId: string, serial: number): Promise<MarkingRun | null> {
    return (
      (await db.query.eggMarkingRuns.findFirst({
        where: and(eq(eggMarkingRuns.lineId, lineId), lte(eggMarkingRuns.firstSerial, serial), gte(eggMarkingRuns.lastSerial, serial)),
      })) ?? null
    );
  }

  async countRunsOn(lineId: string, dayPrefix: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(eggMarkingRuns)
      .where(and(eq(eggMarkingRuns.lineId, lineId), like(eggMarkingRuns.code, `${dayPrefix}%`)));
    return Number(row?.n ?? 0);
  }

  async createRun(input: NewMarkingRun): Promise<MarkingRun> {
    const [row] = await db.insert(eggMarkingRuns).values(input).returning();
    return row;
  }

  async setRunStatus(id: string, from: MarkingRunStatus, changes: Parameters<MarkingRepository["setRunStatus"]>[2]): Promise<MarkingRun | null> {
    const [row] = await db
      .update(eggMarkingRuns)
      .set(changes)
      .where(and(eq(eggMarkingRuns.id, id), eq(eggMarkingRuns.status, from)))
      .returning();
    return row ?? null;
  }

  async addAllocation(id: string, block: SerialRange): Promise<void> {
    await db
      .update(eggMarkingRuns)
      .set({
        firstSerial: sql`coalesce(${eggMarkingRuns.firstSerial}, ${block.firstSerial})`,
        lastSerial: block.lastSerial,
        allocated: sql`${eggMarkingRuns.allocated} + ${block.lastSerial - block.firstSerial + 1}`,
      })
      .where(eq(eggMarkingRuns.id, id));
  }

  async addReads(id: string, ok: number, ko: number): Promise<void> {
    await db
      .update(eggMarkingRuns)
      .set({ printed: sql`${eggMarkingRuns.printed} + ${ok + ko}`, readOk: sql`${eggMarkingRuns.readOk} + ${ok}`, readKo: sql`${eggMarkingRuns.readKo} + ${ko}` })
      .where(eq(eggMarkingRuns.id, id));
  }

  async findBlockByRef(runId: string, requestRef: string): Promise<CodeBlock | null> {
    return (await db.query.eggCodeBlocks.findFirst({ where: and(eq(eggCodeBlocks.runId, runId), eq(eggCodeBlocks.requestRef, requestRef)) })) ?? null;
  }

  async createBlock(input: Omit<CodeBlock, "id">): Promise<CodeBlock> {
    const [row] = await db.insert(eggCodeBlocks).values(input).returning();
    return row;
  }

  async findBatchByRef(runId: string, batchRef: string): Promise<ReadBatch | null> {
    return (await db.query.eggReadBatches.findFirst({ where: and(eq(eggReadBatches.runId, runId), eq(eggReadBatches.batchRef, batchRef)) })) ?? null;
  }

  async listBatchesOverlapping(runId: string, range: SerialRange): Promise<ReadBatch[]> {
    return db.query.eggReadBatches.findMany({ where: and(eq(eggReadBatches.runId, runId), overlapping(eggReadBatches, range)), orderBy: (t) => asc(t.firstSerial) });
  }

  async listRecentBatches(runId: string, since: string, limit: number): Promise<ReadBatch[]> {
    return db.query.eggReadBatches.findMany({
      where: and(eq(eggReadBatches.runId, runId), gte(eggReadBatches.readAt, since)),
      orderBy: (t) => [desc(t.readAt), desc(t.firstSerial)],
      limit,
    });
  }

  async listBatchesByRuns(runIds: string[]): Promise<ReadBatch[]> {
    if (runIds.length === 0) return [];
    return db.query.eggReadBatches.findMany({ where: inArray(eggReadBatches.runId, runIds), orderBy: (t) => asc(t.readAt) });
  }

  async sumReadsSince(since: string): Promise<{ ok: number; ko: number }> {
    const [row] = await db
      .select({ ok: sql<number>`coalesce(sum(${eggReadBatches.ok}), 0)`, ko: sql<number>`coalesce(sum(${eggReadBatches.ko}), 0)` })
      .from(eggReadBatches)
      .where(gte(eggReadBatches.readAt, since));
    return { ok: Number(row?.ok ?? 0), ko: Number(row?.ko ?? 0) };
  }

  async createBatch(input: Omit<ReadBatch, "id">): Promise<ReadBatch> {
    const [row] = await db.insert(eggReadBatches).values(input).returning();
    return row;
  }

  async addExceptions(rows: Omit<EggReadException, "id">[]): Promise<number> {
    let added = 0;
    // Chunked: SQLite caps the number of bound parameters in one statement.
    for (let i = 0; i < rows.length; i += 200) {
      const inserted = await db.insert(eggReadExceptions).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: eggReadExceptions.id });
      added += inserted.length;
    }
    return added;
  }

  async listExceptions(runId: string, kind: EggExceptionKind | null, limit: number): Promise<EggReadException[]> {
    return db.query.eggReadExceptions.findMany({
      where: kind ? and(eq(eggReadExceptions.runId, runId), eq(eggReadExceptions.kind, kind)) : eq(eggReadExceptions.runId, runId),
      orderBy: (t) => asc(t.serial),
      limit,
    });
  }

  async listExceptionsInRange(runId: string, range: SerialRange, kind: EggExceptionKind): Promise<EggReadException[]> {
    return db.query.eggReadExceptions.findMany({
      where: and(eq(eggReadExceptions.runId, runId), eq(eggReadExceptions.kind, kind), gte(eggReadExceptions.serial, range.firstSerial), lte(eggReadExceptions.serial, range.lastSerial)),
    });
  }

  async listExceptionsForSerial(runId: string, serial: number): Promise<EggReadException[]> {
    return db.query.eggReadExceptions.findMany({ where: and(eq(eggReadExceptions.runId, runId), eq(eggReadExceptions.serial, serial)) });
  }

  async listExceptionsByCycle(hatchCycleId: string): Promise<EggReadException[]> {
    return db.query.eggReadExceptions.findMany({ where: eq(eggReadExceptions.hatchCycleId, hatchCycleId), orderBy: (t) => asc(t.at) });
  }

  async findTrayByRef(runId: string, trayRef: string): Promise<EggTray | null> {
    return (await db.query.eggTrays.findFirst({ where: and(eq(eggTrays.runId, runId), eq(eggTrays.trayRef, trayRef)) })) ?? null;
  }

  async findTray(id: string): Promise<EggTray | null> {
    return (await db.query.eggTrays.findFirst({ where: eq(eggTrays.id, id) })) ?? null;
  }

  async listTraysOverlapping(runId: string, range: SerialRange): Promise<EggTray[]> {
    return db.query.eggTrays.findMany({ where: and(eq(eggTrays.runId, runId), overlapping(eggTrays, range)) });
  }

  async listTrays(runId: string, limit: number): Promise<EggTray[]> {
    return db.query.eggTrays.findMany({ where: eq(eggTrays.runId, runId), orderBy: (t) => desc(t.firstSerial), limit });
  }

  async countTrays(runId: string): Promise<{ trays: number; eggs: number }> {
    const [row] = await db
      .select({ trays: sql<number>`count(*)`, eggs: sql<number>`coalesce(sum(${eggTrays.eggCount}), 0)` })
      .from(eggTrays)
      .where(eq(eggTrays.runId, runId));
    return { trays: Number(row?.trays ?? 0), eggs: Number(row?.eggs ?? 0) };
  }

  async createTray(input: Omit<EggTray, "id" | "createdAt">): Promise<EggTray> {
    const [row] = await db.insert(eggTrays).values(input).returning();
    return row;
  }

  async findOpenStop(runId: string): Promise<ReadStop | null> {
    return (await db.query.eggReadStops.findFirst({ where: and(eq(eggReadStops.runId, runId), sql`${eggReadStops.liftedAt} is null`) })) ?? null;
  }

  async listStops(runId: string): Promise<ReadStop[]> {
    return db.query.eggReadStops.findMany({ where: eq(eggReadStops.runId, runId), orderBy: (t) => asc(t.stoppedAt) });
  }

  async createStop(input: Omit<ReadStop, "id" | "liftedAt" | "liftedBy" | "liftNote">): Promise<ReadStop> {
    const [row] = await db.insert(eggReadStops).values(input).returning();
    return row;
  }

  async liftStop(id: string, input: { liftedAt: string; liftedBy: string; liftNote: string }): Promise<ReadStop | null> {
    const [row] = await db
      .update(eggReadStops)
      .set(input)
      .where(and(eq(eggReadStops.id, id), sql`${eggReadStops.liftedAt} is null`))
      .returning();
    return row ?? null;
  }
}
