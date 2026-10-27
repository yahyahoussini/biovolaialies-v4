import { eq } from "drizzle-orm";
import type { CollectionRepository } from "../../domain/production/repositories";
import type { Collection, NewCollection } from "../../domain/production/types";
import { db } from "../db/client";
import { collections } from "../db/schema";

export class DrizzleCollectionRepository implements CollectionRepository {
  async findById(id: string): Promise<Collection | null> {
    const row = await db.query.collections.findFirst({ where: eq(collections.id, id) });
    return (row as Collection | undefined) ?? null;
  }

  async findByCode(code: string): Promise<Collection | null> {
    const row = await db.query.collections.findFirst({ where: eq(collections.code, code) });
    return (row as Collection | undefined) ?? null;
  }

  async listByLot(lotId: string): Promise<Collection[]> {
    const rows = await db.query.collections.findMany({
      where: eq(collections.lotId, lotId),
      orderBy: (t, { desc }) => desc(t.collectedAt),
    });
    return rows as Collection[];
  }

  async list(): Promise<Collection[]> {
    return (await db.query.collections.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) })) as Collection[];
  }

  async create(input: NewCollection): Promise<Collection> {
    const [row] = await db.insert(collections).values(input).returning();
    return row as Collection;
  }
}
