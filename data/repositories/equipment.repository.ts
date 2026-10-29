import { asc, desc, eq } from "drizzle-orm";
import type { NomenclatureArticle } from "../../domain/equipment/nomenclature";
import type { CommissioningRecord } from "../../domain/equipment/recipes";
import type {
  CommissioningRepository,
  EquipmentItem,
  EquipmentRepository,
  NewEquipmentItem,
  NewNomenclatureArticle,
  NomenclatureChanges,
  NomenclatureRepository,
} from "../../domain/equipment/types";
import { db } from "../db/client";
import { commissioningRecords, equipmentItems, nomenclatureArticles } from "../db/schema";

export class DrizzleEquipmentRepository implements EquipmentRepository {
  async createMany(items: NewEquipmentItem[]): Promise<void> {
    if (items.length > 0) await db.insert(equipmentItems).values(items);
  }
  async list(): Promise<EquipmentItem[]> {
    return db.select().from(equipmentItems).orderBy(asc(equipmentItems.unitCode), asc(equipmentItems.sortOrder));
  }
  async findById(id: string): Promise<EquipmentItem | null> {
    return (await db.query.equipmentItems.findFirst({ where: eq(equipmentItems.id, id) })) ?? null;
  }
  async update(id: string, changes: Parameters<EquipmentRepository["update"]>[1]): Promise<EquipmentItem> {
    const [row] = await db.update(equipmentItems).set(changes).where(eq(equipmentItems.id, id)).returning();
    return row;
  }
}

export class DrizzleNomenclatureRepository implements NomenclatureRepository {
  async createMany(articles: NewNomenclatureArticle[]): Promise<void> {
    if (articles.length > 0) await db.insert(nomenclatureArticles).values(articles);
  }
  async list(): Promise<NomenclatureArticle[]> {
    return db.select().from(nomenclatureArticles).orderBy(asc(nomenclatureArticles.sortOrder));
  }
  async findByRef(ref: string): Promise<NomenclatureArticle | null> {
    return (await db.query.nomenclatureArticles.findFirst({ where: eq(nomenclatureArticles.ref, ref) })) ?? null;
  }
  async update(id: string, changes: NomenclatureChanges): Promise<NomenclatureArticle> {
    const [row] = await db.update(nomenclatureArticles).set(changes).where(eq(nomenclatureArticles.id, id)).returning();
    return row;
  }
}

export class DrizzleCommissioningRepository implements CommissioningRepository {
  async create(record: Omit<CommissioningRecord, "id">): Promise<CommissioningRecord> {
    const [row] = await db.insert(commissioningRecords).values(record).returning();
    return row;
  }
  /**
   * Latest run first — by the day the test was run, then by the order it was typed in — so the first
   * row of a test is its current result. A report typed in late for an older run never overrides a
   * newer one.
   */
  async listByBuilding(buildingId: string): Promise<CommissioningRecord[]> {
    return db.query.commissioningRecords.findMany({ where: eq(commissioningRecords.buildingId, buildingId), orderBy: (t) => [desc(t.performedAt), desc(t.recordedAt)] });
  }
  async listAll(): Promise<CommissioningRecord[]> {
    return db.query.commissioningRecords.findMany({ orderBy: (t) => [desc(t.performedAt), desc(t.recordedAt)] });
  }
}
