import { and, eq } from "drizzle-orm";
import type { TransformationBatchRepository } from "../../domain/production/repositories";
import type { NewTransformationBatch, TransformationBatch } from "../../domain/production/types";
import { db } from "../db/client";
import { transformationBatches } from "../db/schema";

export class DrizzleTransformationBatchRepository implements TransformationBatchRepository {
  async findById(id: string): Promise<TransformationBatch | null> {
    const row = await db.query.transformationBatches.findFirst({ where: eq(transformationBatches.id, id) });
    return (row as TransformationBatch | undefined) ?? null;
  }

  async findByCode(code: string): Promise<TransformationBatch | null> {
    const row = await db.query.transformationBatches.findFirst({ where: eq(transformationBatches.code, code) });
    return (row as TransformationBatch | undefined) ?? null;
  }

  async listByUpstream(upstreamType: TransformationBatch["upstreamType"], upstreamId: string): Promise<TransformationBatch[]> {
    const rows = await db.query.transformationBatches.findMany({
      where: and(eq(transformationBatches.upstreamType, upstreamType), eq(transformationBatches.upstreamId, upstreamId)),
      orderBy: (t, { desc }) => desc(t.occurredAt),
    });
    return rows as TransformationBatch[];
  }

  async list(): Promise<TransformationBatch[]> {
    return (await db.query.transformationBatches.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) })) as TransformationBatch[];
  }

  async create(input: NewTransformationBatch): Promise<TransformationBatch> {
    const [row] = await db.insert(transformationBatches).values(input).returning();
    return row as TransformationBatch;
  }
}
