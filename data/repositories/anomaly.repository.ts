import { eq } from "drizzle-orm";
import type { AnomalyRepository } from "../../domain/intelligence/repositories";
import type { Anomaly, NewAnomaly } from "../../domain/intelligence/types";
import type { AnomalyStatus } from "../../domain/shared/enums";
import { NotFoundError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { anomalies } from "../db/schema";

export class DrizzleAnomalyRepository implements AnomalyRepository {
  async findById(id: string): Promise<Anomaly | null> {
    const row = await db.query.anomalies.findFirst({ where: eq(anomalies.id, id) });
    return (row as Anomaly | undefined) ?? null;
  }

  async list(): Promise<Anomaly[]> {
    const rows = await db.query.anomalies.findMany({ orderBy: (t, { desc }) => desc(t.detectedAt) });
    return rows as Anomaly[];
  }

  async listByLot(lotId: string): Promise<Anomaly[]> {
    const rows = await db.query.anomalies.findMany({
      where: eq(anomalies.lotId, lotId),
      orderBy: (t, { desc }) => desc(t.detectedAt),
    });
    return rows as Anomaly[];
  }

  async listByBuilding(buildingId: string): Promise<Anomaly[]> {
    const rows = await db.query.anomalies.findMany({
      where: eq(anomalies.buildingId, buildingId),
      orderBy: (t, { desc }) => desc(t.detectedAt),
    });
    return rows as Anomaly[];
  }

  async create(input: NewAnomaly): Promise<Anomaly> {
    const [row] = await db.insert(anomalies).values(input).returning();
    return row as Anomaly;
  }

  async updateStatus(id: string, status: AnomalyStatus): Promise<Anomaly> {
    const [row] = await db.update(anomalies).set({ status }).where(eq(anomalies.id, id)).returning();
    if (!row) throw new NotFoundError("Anomaly", id);
    return row as Anomaly;
  }

  async updateSeverity(id: string, severity: Anomaly["severity"]): Promise<void> {
    await db.update(anomalies).set({ severity }).where(eq(anomalies.id, id));
  }
}
