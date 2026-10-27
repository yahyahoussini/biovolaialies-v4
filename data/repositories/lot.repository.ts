import { eq } from "drizzle-orm";
import type { LotRepository } from "../../domain/production/repositories";
import type { Lot, NewLot } from "../../domain/production/types";
import type { LotStatus } from "../../domain/shared/enums";
import { NotFoundError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { lots } from "../db/schema";

export class DrizzleLotRepository implements LotRepository {
  async findById(id: string): Promise<Lot | null> {
    const row = await db.query.lots.findFirst({ where: eq(lots.id, id) });
    return row ?? null;
  }

  async findByCode(code: string): Promise<Lot | null> {
    const row = await db.query.lots.findFirst({ where: eq(lots.code, code) });
    return row ?? null;
  }

  async listByBuilding(buildingId: string): Promise<Lot[]> {
    return db.query.lots.findMany({
      where: eq(lots.buildingId, buildingId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  async list(): Promise<Lot[]> {
    return db.query.lots.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) });
  }

  async create(input: NewLot): Promise<Lot> {
    const [row] = await db.insert(lots).values(input).returning();
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<Lot, "species" | "breed" | "plannedStartAt" | "dataStatus">>
  ): Promise<Lot> {
    const [row] = await db.update(lots).set(patch).where(eq(lots.id, id)).returning();
    if (!row) throw new NotFoundError("Lot", id);
    return row;
  }

  async updateStatus(
    id: string,
    status: LotStatus,
    extra?: Partial<Pick<Lot, "startedAt" | "endedAt">>
  ): Promise<Lot> {
    const [row] = await db
      .update(lots)
      .set({ status, ...extra })
      .where(eq(lots.id, id))
      .returning();
    if (!row) throw new NotFoundError("Lot", id);
    return row;
  }

  async updateFlow(id: string, patch: Parameters<LotRepository["updateFlow"]>[1]): Promise<Lot> {
    const [row] = await db.update(lots).set(patch).where(eq(lots.id, id)).returning();
    if (!row) throw new NotFoundError("Lot", id);
    return row;
  }

  async updatePopulation(id: string, currentPopulation: number): Promise<Lot> {
    const [row] = await db.update(lots).set({ currentPopulation }).where(eq(lots.id, id)).returning();
    if (!row) throw new NotFoundError("Lot", id);
    return row;
  }
}
