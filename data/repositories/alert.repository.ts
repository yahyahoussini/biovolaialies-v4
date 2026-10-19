import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { AlertRepository } from "../../domain/intelligence/repositories";
import type { Alert, NewAlert } from "../../domain/intelligence/types";
import { NotFoundError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { alerts } from "../db/schema";

export class DrizzleAlertRepository implements AlertRepository {
  async findById(id: string): Promise<Alert | null> {
    const row = await db.query.alerts.findFirst({ where: eq(alerts.id, id) });
    return row ?? null;
  }

  async list(): Promise<Alert[]> {
    return db.query.alerts.findMany({ orderBy: (t, { desc }) => desc(t.raisedAt) });
  }

  async findByAnomalyId(anomalyId: string): Promise<Alert | null> {
    const row = await db.query.alerts.findFirst({ where: eq(alerts.anomalyId, anomalyId) });
    return row ?? null;
  }

  async listByAnomalyIds(anomalyIds: string[]): Promise<Alert[]> {
    if (anomalyIds.length === 0) return [];
    return db.query.alerts.findMany({
      where: inArray(alerts.anomalyId, anomalyIds),
      orderBy: (t, { desc }) => desc(t.raisedAt),
    });
  }

  async create(input: NewAlert): Promise<Alert> {
    const [row] = await db.insert(alerts).values(input).returning();
    return row;
  }

  async updateStatus(id: string, status: Alert["status"], resolvedAt: string | null): Promise<Alert> {
    const [row] = await db.update(alerts).set({ status, resolvedAt }).where(eq(alerts.id, id)).returning();
    if (!row) throw new NotFoundError("Alert", id);
    return row;
  }

  async setEscalation(id: string, level: number, nextEscalationAt: string | null): Promise<void> {
    await db.update(alerts).set({ escalationLevel: level, nextEscalationAt }).where(eq(alerts.id, id));
  }

  async setOutcome(id: string, outcome: NonNullable<Alert["outcome"]>): Promise<void> {
    await db.update(alerts).set({ outcome }).where(eq(alerts.id, id));
  }

  async listDueForEscalation(now: string): Promise<Alert[]> {
    return db.query.alerts.findMany({
      where: and(eq(alerts.status, "OPEN"), isNotNull(alerts.nextEscalationAt), lte(alerts.nextEscalationAt, now)),
    });
  }
}
