import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { LabRepository, LabResult, LabSample, NewLabResult, NewLabSample, SampleObjectType, SampleStatus } from "../../domain/lab/lab";
import { db } from "../db/client";
import { labResults, labSamples } from "../db/schema";

export class DrizzleLabRepository implements LabRepository {
  async findSample(id: string): Promise<LabSample | null> {
    return (await db.query.labSamples.findFirst({ where: eq(labSamples.id, id) })) ?? null;
  }

  async listSamples(): Promise<LabSample[]> {
    return db.query.labSamples.findMany({ orderBy: (t) => desc(t.sampledAt) });
  }

  async listSamplesFor(objectType: SampleObjectType, objectIds: string[]): Promise<LabSample[]> {
    if (objectIds.length === 0) return [];
    return db.query.labSamples.findMany({ where: and(eq(labSamples.objectType, objectType), inArray(labSamples.objectId, objectIds)), orderBy: (t) => desc(t.sampledAt) });
  }

  async countSamplesInYear(year: number): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(labSamples)
      .where(like(labSamples.code, `LAB-${year}-%`));
    return Number(row?.n ?? 0);
  }

  async createSample(input: NewLabSample): Promise<LabSample> {
    const [row] = await db.insert(labSamples).values(input).returning();
    return row;
  }

  async setSampleStatus(id: string, from: SampleStatus, changes: Partial<Pick<LabSample, "status" | "sentAt" | "laboratory">>): Promise<LabSample | null> {
    const [row] = await db
      .update(labSamples)
      .set(changes)
      .where(and(eq(labSamples.id, id), eq(labSamples.status, from)))
      .returning();
    return row ?? null;
  }

  async listResults(sampleIds: string[]): Promise<LabResult[]> {
    if (sampleIds.length === 0) return [];
    return db.query.labResults.findMany({ where: inArray(labResults.sampleId, sampleIds), orderBy: (t) => asc(t.resultAt) });
  }

  async findResult(id: string): Promise<LabResult | null> {
    return (await db.query.labResults.findFirst({ where: eq(labResults.id, id) })) ?? null;
  }

  async createResult(input: NewLabResult & { recordedAt: string }): Promise<LabResult> {
    const [row] = await db.insert(labResults).values(input).returning();
    return row;
  }

  async reviewResult(id: string, input: { reviewedBy: string; reviewedAt: string; reviewNote: string }): Promise<LabResult | null> {
    const [row] = await db
      .update(labResults)
      .set(input)
      .where(and(eq(labResults.id, id), sql`${labResults.reviewedAt} is null`))
      .returning();
    return row ?? null;
  }
}
