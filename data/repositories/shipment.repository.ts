import { eq } from "drizzle-orm";
import type { NewShipment, Shipment, ShipmentRepository } from "../../domain/traceability/shipment";
import { db } from "../db/client";
import { shipments } from "../db/schema";

export class DrizzleShipmentRepository implements ShipmentRepository {
  async findById(id: string) {
    return ((await db.query.shipments.findFirst({ where: eq(shipments.id, id) })) as Shipment | undefined) ?? null;
  }
  async findByCode(code: string) {
    return ((await db.query.shipments.findFirst({ where: eq(shipments.code, code) })) as Shipment | undefined) ?? null;
  }
  async list() {
    return (await db.query.shipments.findMany({ orderBy: (t, { desc }) => desc(t.shippedAt) })) as Shipment[];
  }
  async listByProduct(productId: string) {
    return (await db.query.shipments.findMany({ where: eq(shipments.productId, productId) })) as Shipment[];
  }
  async create(input: NewShipment) {
    const [row] = await db.insert(shipments).values(input).returning();
    return row as Shipment;
  }
}
