import { eq } from "drizzle-orm";
import type { SlaughterBatchRepository } from "../../domain/production/repositories";
import type { NewSlaughterBatch, SlaughterBatch } from "../../domain/production/types";
import { db } from "../db/client";
import { slaughterBatches } from "../db/schema";

export class DrizzleSlaughterBatchRepository implements SlaughterBatchRepository {
  async findById(id: string): Promise<SlaughterBatch | null> {
    const row = await db.query.slaughterBatches.findFirst({ where: eq(slaughterBatches.id, id) });
    return (row as SlaughterBatch | undefined) ?? null;
  }

  async findByCode(code: string): Promise<SlaughterBatch | null> {
    const row = await db.query.slaughterBatches.findFirst({ where: eq(slaughterBatches.code, code) });
    return (row as SlaughterBatch | undefined) ?? null;
  }

  async listBySourceLot(lotId: string): Promise<SlaughterBatch[]> {
    const rows = await db.query.slaughterBatches.findMany({
      where: eq(slaughterBatches.sourceLotId, lotId),
      orderBy: (t, { desc }) => desc(t.slaughteredAt),
    });
    return rows as SlaughterBatch[];
  }

  async list(): Promise<SlaughterBatch[]> {
    return (await db.query.slaughterBatches.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) })) as SlaughterBatch[];
  }

  async create(input: NewSlaughterBatch): Promise<SlaughterBatch> {
    const [row] = await db.insert(slaughterBatches).values(input).returning();
    return row as SlaughterBatch;
  }
}
