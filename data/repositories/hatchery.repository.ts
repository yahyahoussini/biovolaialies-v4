import { eq } from "drizzle-orm";
import type {
  ChickLot,
  ChickLotRepository,
  CodedRepository,
  EggLot,
  EggLotRepository,
  HatchCycle,
  HatchCycleRepository,
  NewChickLot,
  NewEggLot,
  NewHatchCycle,
  NewParentFlock,
  ParentFlock,
} from "../../domain/hatchery/types";
import { db } from "../db/client";
import { chickLots, eggLots, hatchCycles, parentFlocks } from "../db/schema";

export class DrizzleParentFlockRepository implements CodedRepository<ParentFlock, NewParentFlock> {
  async findById(id: string) {
    return ((await db.query.parentFlocks.findFirst({ where: eq(parentFlocks.id, id) })) as ParentFlock | undefined) ?? null;
  }
  async findByCode(code: string) {
    return ((await db.query.parentFlocks.findFirst({ where: eq(parentFlocks.code, code) })) as ParentFlock | undefined) ?? null;
  }
  async list() {
    return (await db.query.parentFlocks.findMany({ orderBy: (t, { desc }) => desc(t.placedAt) })) as ParentFlock[];
  }
  async create(input: NewParentFlock) {
    const [row] = await db.insert(parentFlocks).values(input).returning();
    return row as ParentFlock;
  }
}

export class DrizzleEggLotRepository implements EggLotRepository {
  async findById(id: string) {
    return ((await db.query.eggLots.findFirst({ where: eq(eggLots.id, id) })) as EggLot | undefined) ?? null;
  }
  async findByCode(code: string) {
    return ((await db.query.eggLots.findFirst({ where: eq(eggLots.code, code) })) as EggLot | undefined) ?? null;
  }
  async list() {
    return (await db.query.eggLots.findMany({ orderBy: (t, { desc }) => desc(t.collectedAt) })) as EggLot[];
  }
  async listByParentFlock(parentFlockId: string) {
    return (await db.query.eggLots.findMany({ where: eq(eggLots.parentFlockId, parentFlockId) })) as EggLot[];
  }
  async create(input: NewEggLot) {
    const [row] = await db.insert(eggLots).values(input).returning();
    return row as EggLot;
  }
  async updateStorage(id: string, storageBuildingId: string) {
    const [row] = await db.update(eggLots).set({ storageBuildingId }).where(eq(eggLots.id, id)).returning();
    return row as EggLot;
  }
}

export class DrizzleHatchCycleRepository implements HatchCycleRepository {
  async findById(id: string) {
    return ((await db.query.hatchCycles.findFirst({ where: eq(hatchCycles.id, id) })) as HatchCycle | undefined) ?? null;
  }
  async findByCode(code: string) {
    return ((await db.query.hatchCycles.findFirst({ where: eq(hatchCycles.code, code) })) as HatchCycle | undefined) ?? null;
  }
  async list() {
    return (await db.query.hatchCycles.findMany({ orderBy: (t, { desc }) => desc(t.setAt) })) as HatchCycle[];
  }
  async create(input: NewHatchCycle) {
    const [row] = await db.insert(hatchCycles).values(input).returning();
    return row as HatchCycle;
  }
  async update(id: string, changes: Parameters<HatchCycleRepository["update"]>[1]) {
    const [row] = await db.update(hatchCycles).set(changes).where(eq(hatchCycles.id, id)).returning();
    return row as HatchCycle;
  }
}

export class DrizzleChickLotRepository implements ChickLotRepository {
  async findById(id: string) {
    return ((await db.query.chickLots.findFirst({ where: eq(chickLots.id, id) })) as ChickLot | undefined) ?? null;
  }
  async findByCode(code: string) {
    return ((await db.query.chickLots.findFirst({ where: eq(chickLots.code, code) })) as ChickLot | undefined) ?? null;
  }
  async list() {
    return (await db.query.chickLots.findMany({ orderBy: (t, { desc }) => desc(t.dispatchedAt) })) as ChickLot[];
  }
  async listByCycle(hatchCycleId: string) {
    return (await db.query.chickLots.findMany({ where: eq(chickLots.hatchCycleId, hatchCycleId) })) as ChickLot[];
  }
  async create(input: NewChickLot) {
    const [row] = await db.insert(chickLots).values(input).returning();
    return row as ChickLot;
  }
}
