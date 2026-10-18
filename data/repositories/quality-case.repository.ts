import { and, count, eq, exists, sql } from "drizzle-orm";
import type {
  NewQualityCase,
  QualityCase,
  QualityCaseDecision,
  QualityCaseRepository,
  QualityHoldItem,
} from "../../domain/quality/holds";
import { db } from "../db/client";
import { qualityCases, qualityHoldItems } from "../db/schema";

export class DrizzleQualityCaseRepository implements QualityCaseRepository {
  async createWithItems(
    input: NewQualityCase,
    items: { objectType: string; objectId: string; depth: number }[]
  ): Promise<QualityCase> {
    // One atomic batch (see data/repositories/transactions.ts for why not db.transaction):
    // a case must never exist without the items it blocks, or vice versa.
    const caseId = crypto.randomUUID();
    const insertCase = db.insert(qualityCases).values({ ...input, id: caseId }).returning();
    if (items.length === 0) {
      const [created] = await insertCase;
      return created as QualityCase;
    }
    const [[created]] = await db.batch([
      insertCase,
      db.insert(qualityHoldItems).values(items.map((item) => ({ ...item, caseId, active: true }))),
    ]);
    return created as QualityCase;
  }

  async addItems(caseId: string, items: { objectType: string; objectId: string; depth: number }[]): Promise<void> {
    if (items.length > 0) await db.insert(qualityHoldItems).values(items.map((item) => ({ ...item, caseId, active: true })));
  }

  async findById(id: string): Promise<QualityCase | null> {
    const row = await db.query.qualityCases.findFirst({ where: eq(qualityCases.id, id) });
    return (row as QualityCase | undefined) ?? null;
  }

  async list(): Promise<QualityCase[]> {
    return (await db.query.qualityCases.findMany({ orderBy: (t, { desc }) => desc(t.openedAt) })) as QualityCase[];
  }

  async count(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(qualityCases);
    return row?.value ?? 0;
  }

  async listItems(caseId: string): Promise<QualityHoldItem[]> {
    return db.query.qualityHoldItems.findMany({
      where: eq(qualityHoldItems.caseId, caseId),
      orderBy: (t, { asc }) => [asc(t.depth), asc(t.objectType)],
    });
  }

  async listActiveItemsFor(objectType: string, objectId: string): Promise<QualityHoldItem[]> {
    return db.query.qualityHoldItems.findMany({
      where: and(
        eq(qualityHoldItems.objectType, objectType),
        eq(qualityHoldItems.objectId, objectId),
        eq(qualityHoldItems.active, true)
      ),
    });
  }

  /**
   * Compare-and-set: only a case still EN_BLOCAGE can be decided, so two simultaneous
   * decisions cannot both apply. Returns null when another decision got there first. For a
   * release, the hold items are deactivated in the same batch — and only if the case row now
   * carries THIS decision, so a losing concurrent release cannot unblock anything.
   */
  async decide(caseId: string, decision: QualityCaseDecision): Promise<QualityCase | null> {
    const updateCase = db
      .update(qualityCases)
      .set(decision)
      .where(and(eq(qualityCases.id, caseId), eq(qualityCases.status, "EN_BLOCAGE")))
      .returning();
    if (decision.status !== "LIBERE") {
      const [updated] = await updateCase;
      return (updated as QualityCase | undefined) ?? null;
    }
    const [[updated]] = await db.batch([
      updateCase,
      db
        .update(qualityHoldItems)
        .set({ active: false })
        .where(
          and(
            eq(qualityHoldItems.caseId, caseId),
            exists(
              db
                .select({ one: sql`1` })
                .from(qualityCases)
                .where(and(eq(qualityCases.id, caseId), eq(qualityCases.status, "LIBERE"), eq(qualityCases.decidedAt, decision.decidedAt), eq(qualityCases.decidedBy, decision.decidedBy)))
            )
          )
        ),
    ]);
    return (updated as QualityCase | undefined) ?? null;
  }
}
