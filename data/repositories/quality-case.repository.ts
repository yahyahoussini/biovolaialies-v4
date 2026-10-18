import { and, count, eq } from "drizzle-orm";
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
    // One transaction: a case must never exist without the items it blocks, or vice versa.
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(qualityCases).values(input).returning();
      if (items.length > 0) {
        await tx.insert(qualityHoldItems).values(items.map((item) => ({ ...item, caseId: created.id, active: true })));
      }
      return created as QualityCase;
    });
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

  async decide(caseId: string, decision: QualityCaseDecision): Promise<QualityCase> {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(qualityCases).set(decision).where(eq(qualityCases.id, caseId)).returning();
      if (decision.status === "LIBERE") {
        await tx.update(qualityHoldItems).set({ active: false }).where(eq(qualityHoldItems.caseId, caseId));
      }
      return updated as QualityCase;
    });
  }
}
