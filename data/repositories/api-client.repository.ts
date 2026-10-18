import { eq } from "drizzle-orm";
import type { ApiClient, ApiClientRepository, NewApiClient } from "../../domain/api/types";
import { db } from "../db/client";
import { apiClients } from "../db/schema";

export class DrizzleApiClientRepository implements ApiClientRepository {
  async create(input: NewApiClient): Promise<ApiClient> {
    const [row] = await db.insert(apiClients).values(input).returning();
    return row as ApiClient;
  }
  async findByKeyHash(hash: string): Promise<ApiClient | null> {
    return ((await db.query.apiClients.findFirst({ where: eq(apiClients.keyHash, hash) })) as ApiClient | undefined) ?? null;
  }
  async findById(id: string): Promise<ApiClient | null> {
    return ((await db.query.apiClients.findFirst({ where: eq(apiClients.id, id) })) as ApiClient | undefined) ?? null;
  }
  async list(): Promise<ApiClient[]> {
    return (await db.query.apiClients.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) })) as ApiClient[];
  }
  async touch(id: string, at: string): Promise<void> {
    await db.update(apiClients).set({ lastUsedAt: at }).where(eq(apiClients.id, id));
  }
  async revoke(id: string, at: string): Promise<ApiClient> {
    const [row] = await db.update(apiClients).set({ active: false, revokedAt: at }).where(eq(apiClients.id, id)).returning();
    return row as ApiClient;
  }
}
