import { eq } from "drizzle-orm";
import type { ProductRepository } from "../../domain/traceability/repositories";
import type { NewProduct, Product } from "../../domain/traceability/types";
import { db } from "../db/client";
import { products } from "../db/schema";

export class DrizzleProductRepository implements ProductRepository {
  async findById(id: string): Promise<Product | null> {
    const row = await db.query.products.findFirst({ where: eq(products.id, id) });
    return (row as Product | undefined) ?? null;
  }

  async findByCode(code: string): Promise<Product | null> {
    const row = await db.query.products.findFirst({ where: eq(products.code, code) });
    return (row as Product | undefined) ?? null;
  }

  async listByTransformationBatch(transformationBatchId: string): Promise<Product[]> {
    const rows = await db.query.products.findMany({ where: eq(products.transformationBatchId, transformationBatchId) });
    return rows as Product[];
  }

  async list(): Promise<Product[]> {
    return (await db.query.products.findMany({ orderBy: (t, { desc }) => desc(t.packagingDate) })) as Product[];
  }

  async create(input: NewProduct): Promise<Product> {
    const [row] = await db.insert(products).values(input).returning();
    return row as Product;
  }
}
