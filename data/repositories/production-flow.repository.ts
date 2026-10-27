import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type {
  BvuIdRecord,
  IdentifierAlias,
  NewIdentifierAlias,
  NewSubject,
  NewSubjectEvent,
  NewTableEggLot,
  NewTransfer,
  Subject,
  SubjectEvent,
  TableEggLot,
  Transfer,
} from "../../domain/production/flow";
import type { LotPhaseRecord, NewLotPhaseRecord, NewProductionLine, ProductionLine } from "../../domain/production/lines";
import type { TableEggLotStatus, TransferStatus } from "../../domain/shared/enums";
import { NotFoundError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { bvuIds, identifierAliases, lotPhases, productionLines, subjectEvents, subjects, tableEggLots, transfers } from "../db/schema";

export class DrizzleProductionLineRepository {
  async list(): Promise<ProductionLine[]> {
    return (await db.query.productionLines.findMany({ orderBy: (t) => asc(t.code) })) as ProductionLine[];
  }
  async findByCode(code: string): Promise<ProductionLine | null> {
    return ((await db.query.productionLines.findFirst({ where: eq(productionLines.code, code) })) as ProductionLine | undefined) ?? null;
  }
  async create(input: NewProductionLine): Promise<ProductionLine> {
    const [row] = await db.insert(productionLines).values(input).returning();
    return row as ProductionLine;
  }
  /** Inserts the line unless its code exists — seeding never overwrites an edited line. */
  async insertIfMissing(input: NewProductionLine): Promise<void> {
    await db.insert(productionLines).values(input).onConflictDoNothing({ target: productionLines.code });
  }
  async update(code: string, patch: Partial<Omit<ProductionLine, "id" | "code" | "createdAt">>): Promise<ProductionLine> {
    const [row] = await db.update(productionLines).set(patch).where(eq(productionLines.code, code)).returning();
    if (!row) throw new NotFoundError("Ligne de production", code);
    return row as ProductionLine;
  }
}

export class DrizzleLotPhaseRepository {
  async listByLot(lotId: string): Promise<LotPhaseRecord[]> {
    return (await db.query.lotPhases.findMany({ where: eq(lotPhases.lotId, lotId), orderBy: (t) => [asc(t.startedAt), asc(t.createdAt)] })) as LotPhaseRecord[];
  }
  async listOpen(): Promise<LotPhaseRecord[]> {
    return (await db.query.lotPhases.findMany({ where: isNull(lotPhases.endedAt) })) as LotPhaseRecord[];
  }
  async current(lotId: string): Promise<LotPhaseRecord | null> {
    return ((await db.query.lotPhases.findFirst({ where: and(eq(lotPhases.lotId, lotId), isNull(lotPhases.endedAt)) })) as LotPhaseRecord | undefined) ?? null;
  }
  /** Closes the open phase (if any) and opens the next one in a single batch, so a lot never has two open phases. */
  async startNext(input: NewLotPhaseRecord, closePrevious: { id: string; endedAt: string } | null): Promise<LotPhaseRecord> {
    const insert = db.insert(lotPhases).values(input).returning();
    if (!closePrevious) {
      const [row] = await insert;
      return row as LotPhaseRecord;
    }
    const [, [row]] = await db.batch([
      db.update(lotPhases).set({ endedAt: closePrevious.endedAt }).where(and(eq(lotPhases.id, closePrevious.id), isNull(lotPhases.endedAt))),
      insert,
    ]);
    return row as LotPhaseRecord;
  }
  async close(id: string, endedAt: string): Promise<void> {
    await db.update(lotPhases).set({ endedAt }).where(and(eq(lotPhases.id, id), isNull(lotPhases.endedAt)));
  }
}

export class DrizzleTransferRepository {
  async findById(id: string): Promise<Transfer | null> {
    return ((await db.query.transfers.findFirst({ where: eq(transfers.id, id) })) as Transfer | undefined) ?? null;
  }
  async findByCode(code: string): Promise<Transfer | null> {
    return ((await db.query.transfers.findFirst({ where: eq(transfers.code, code) })) as Transfer | undefined) ?? null;
  }
  async list(): Promise<Transfer[]> {
    return (await db.query.transfers.findMany({ orderBy: (t) => desc(t.sentAt) })) as Transfer[];
  }
  async listByObject(objectType: string, objectId: string): Promise<Transfer[]> {
    return (await db.query.transfers.findMany({ where: and(eq(transfers.objectType, objectType as Transfer["objectType"]), eq(transfers.objectId, objectId)), orderBy: (t) => asc(t.sentAt) })) as Transfer[];
  }
  async listByDestinationLot(lotId: string): Promise<Transfer[]> {
    return (await db.query.transfers.findMany({ where: eq(transfers.destinationLotId, lotId), orderBy: (t) => asc(t.sentAt) })) as Transfer[];
  }
  async create(input: NewTransfer): Promise<Transfer> {
    const [row] = await db.insert(transfers).values(input).returning();
    return row as Transfer;
  }
  /**
   * Compare-and-set on the status: the update applies only if the transfer is still in the state
   * the caller read. Two people receiving the same truck at once — one wins, the other is told.
   */
  async updateIfStatus(id: string, expected: TransferStatus, patch: Partial<Omit<Transfer, "id" | "code" | "createdAt">>): Promise<Transfer | null> {
    const [row] = await db
      .update(transfers)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(and(eq(transfers.id, id), eq(transfers.status, expected)))
      .returning();
    return (row as Transfer | undefined) ?? null;
  }
}

export class DrizzleSubjectRepository {
  async findById(id: string): Promise<Subject | null> {
    return ((await db.query.subjects.findFirst({ where: eq(subjects.id, id) })) as Subject | undefined) ?? null;
  }
  async findByBvuId(bvuId: string): Promise<Subject | null> {
    return ((await db.query.subjects.findFirst({ where: eq(subjects.bvuId, bvuId) })) as Subject | undefined) ?? null;
  }
  async findByVisualId(visualId: string): Promise<Subject | null> {
    return ((await db.query.subjects.findFirst({ where: eq(subjects.visualId, visualId) })) as Subject | undefined) ?? null;
  }
  async findByRfid(rfidUid: string): Promise<Subject | null> {
    return ((await db.query.subjects.findFirst({ where: eq(subjects.rfidUid, rfidUid) })) as Subject | undefined) ?? null;
  }
  async listByLot(lotId: string): Promise<Subject[]> {
    return (await db.query.subjects.findMany({ where: eq(subjects.lotId, lotId), orderBy: (t) => asc(t.visualId) })) as Subject[];
  }
  async listByLots(lotIds: string[]): Promise<Subject[]> {
    if (lotIds.length === 0) return [];
    return (await db.query.subjects.findMany({ where: inArray(subjects.lotId, lotIds) })) as Subject[];
  }
  async createMany(input: NewSubject[]): Promise<Subject[]> {
    if (input.length === 0) return [];
    return (await db.insert(subjects).values(input).returning()) as Subject[];
  }
  async update(id: string, patch: Partial<Pick<Subject, "status" | "statusAt" | "statusReason" | "rfidUid" | "lotId" | "notes">>): Promise<Subject> {
    const [row] = await db.update(subjects).set(patch).where(eq(subjects.id, id)).returning();
    if (!row) throw new NotFoundError("Sujet", id);
    return row as Subject;
  }
}

export class DrizzleSubjectEventRepository {
  async listBySubject(subjectId: string): Promise<SubjectEvent[]> {
    return (await db.query.subjectEvents.findMany({ where: eq(subjectEvents.subjectId, subjectId), orderBy: (t) => desc(t.occurredAt) })) as SubjectEvent[];
  }
  async create(input: NewSubjectEvent): Promise<SubjectEvent> {
    const [row] = await db.insert(subjectEvents).values(input).returning();
    return row as SubjectEvent;
  }
}

export class DrizzleTableEggLotRepository {
  async findById(id: string): Promise<TableEggLot | null> {
    return ((await db.query.tableEggLots.findFirst({ where: eq(tableEggLots.id, id) })) as TableEggLot | undefined) ?? null;
  }
  async findByCode(code: string): Promise<TableEggLot | null> {
    return ((await db.query.tableEggLots.findFirst({ where: eq(tableEggLots.code, code) })) as TableEggLot | undefined) ?? null;
  }
  async list(): Promise<TableEggLot[]> {
    return (await db.query.tableEggLots.findMany({ orderBy: (t) => desc(t.collectedOn) })) as TableEggLot[];
  }
  async listByLot(lotId: string): Promise<TableEggLot[]> {
    return (await db.query.tableEggLots.findMany({ where: eq(tableEggLots.lotId, lotId), orderBy: (t) => desc(t.collectedOn) })) as TableEggLot[];
  }
  async create(input: NewTableEggLot): Promise<TableEggLot> {
    const [row] = await db.insert(tableEggLots).values(input).returning();
    return row as TableEggLot;
  }
  async updateStatusIf(id: string, expected: TableEggLotStatus, status: TableEggLotStatus): Promise<TableEggLot | null> {
    const [row] = await db.update(tableEggLots).set({ status }).where(and(eq(tableEggLots.id, id), eq(tableEggLots.status, expected))).returning();
    return (row as TableEggLot | undefined) ?? null;
  }
}

export class DrizzleBvuIdRepository {
  async find(bvuId: string): Promise<BvuIdRecord | null> {
    return ((await db.query.bvuIds.findFirst({ where: eq(bvuIds.bvuId, bvuId) })) as BvuIdRecord | undefined) ?? null;
  }
  async findByObject(objectType: string, objectId: string): Promise<BvuIdRecord | null> {
    return ((await db.query.bvuIds.findFirst({ where: and(eq(bvuIds.objectType, objectType), eq(bvuIds.objectId, objectId)) })) as BvuIdRecord | undefined) ?? null;
  }
  async listByObjects(objectType: string, objectIds: string[]): Promise<BvuIdRecord[]> {
    if (objectIds.length === 0) return [];
    return (await db.query.bvuIds.findMany({ where: and(eq(bvuIds.objectType, objectType), inArray(bvuIds.objectId, objectIds)) })) as BvuIdRecord[];
  }
  /** Returns false when the object already has an identifier or the identifier is taken — the caller re-reads. */
  async insertIfAbsent(record: Omit<BvuIdRecord, "createdAt">): Promise<boolean> {
    const rows = await db.insert(bvuIds).values(record).onConflictDoNothing().returning();
    return rows.length > 0;
  }
}

export class DrizzleIdentifierAliasRepository {
  async listByBvuId(bvuId: string): Promise<IdentifierAlias[]> {
    return (await db.query.identifierAliases.findMany({ where: eq(identifierAliases.bvuId, bvuId), orderBy: (t) => asc(t.validFrom) })) as IdentifierAlias[];
  }
  async findActive(scheme: string, value: string, issuer?: string): Promise<IdentifierAlias[]> {
    const conditions = [eq(identifierAliases.scheme, scheme as IdentifierAlias["scheme"]), eq(identifierAliases.value, value), isNull(identifierAliases.validTo)];
    if (issuer !== undefined) conditions.push(eq(identifierAliases.issuer, issuer));
    return (await db.query.identifierAliases.findMany({ where: and(...conditions) })) as IdentifierAlias[];
  }
  async findActiveByValue(value: string): Promise<IdentifierAlias[]> {
    return (await db.query.identifierAliases.findMany({ where: and(eq(identifierAliases.value, value), isNull(identifierAliases.validTo)) })) as IdentifierAlias[];
  }
  async findById(id: string): Promise<IdentifierAlias | null> {
    return ((await db.query.identifierAliases.findFirst({ where: eq(identifierAliases.id, id) })) as IdentifierAlias | undefined) ?? null;
  }
  async create(input: NewIdentifierAlias): Promise<IdentifierAlias> {
    const [row] = await db.insert(identifierAliases).values(input).returning();
    return row as IdentifierAlias;
  }
  async retire(id: string, validTo: string, reason: string): Promise<IdentifierAlias | null> {
    const [row] = await db
      .update(identifierAliases)
      .set({ validTo, reason })
      .where(and(eq(identifierAliases.id, id), isNull(identifierAliases.validTo)))
      .returning();
    return (row as IdentifierAlias | undefined) ?? null;
  }
}
