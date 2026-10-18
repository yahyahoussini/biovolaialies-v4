import { asc, eq } from "drizzle-orm";
import type { CommissioningTest, EquipmentItem, EquipmentRepository, NewEquipmentItem } from "../../domain/equipment/types";
import { db } from "../db/client";
import { commissioningTests, equipmentItems } from "../db/schema";

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
  async createTests(tests: Omit<CommissioningTest, "id">[]): Promise<void> {
    if (tests.length > 0) await db.insert(commissioningTests).values(tests);
  }
  async listTests(): Promise<CommissioningTest[]> {
    return db.select().from(commissioningTests).orderBy(asc(commissioningTests.code));
  }
  async findTestById(id: string): Promise<CommissioningTest | null> {
    return (await db.query.commissioningTests.findFirst({ where: eq(commissioningTests.id, id) })) ?? null;
  }
  async updateTest(id: string, changes: Parameters<EquipmentRepository["updateTest"]>[1]): Promise<CommissioningTest> {
    const [row] = await db.update(commissioningTests).set(changes).where(eq(commissioningTests.id, id)).returning();
    return row;
  }
}
