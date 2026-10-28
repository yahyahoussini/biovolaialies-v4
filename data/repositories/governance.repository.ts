import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AuthEvent, AuthEventRepository, AuthOutcome, ExportRecord, ExportRecordRepository } from "../../domain/governance/governance";
import { db } from "../db/client";
import { authEvents, exportRecords } from "../db/schema";

export class DrizzleAuthEventRepository implements AuthEventRepository {
  async record(input: Omit<AuthEvent, "id">): Promise<AuthEvent> {
    const [row] = await db.insert(authEvents).values(input).returning();
    return row;
  }

  async countSince(field: "email" | "clientHash", value: string, outcome: AuthOutcome, since: string): Promise<number> {
    const column = field === "email" ? authEvents.email : authEvents.clientHash;
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(authEvents)
      .where(and(eq(column, value), eq(authEvents.outcome, outcome), gte(authEvents.at, since)));
    return Number(row?.n ?? 0);
  }

  async list(filters: { email?: string; outcome?: AuthOutcome }, limit: number): Promise<AuthEvent[]> {
    const conditions = [filters.email ? eq(authEvents.email, filters.email) : undefined, filters.outcome ? eq(authEvents.outcome, filters.outcome) : undefined].filter((c) => c !== undefined);
    return db.query.authEvents.findMany({ where: conditions.length ? and(...conditions) : undefined, orderBy: (t) => desc(t.at), limit });
  }
}

export class DrizzleExportRecordRepository implements ExportRecordRepository {
  async create(input: Omit<ExportRecord, "id">): Promise<ExportRecord> {
    const [row] = await db.insert(exportRecords).values(input).returning();
    return row;
  }

  async findBySha256(sha256: string): Promise<ExportRecord[]> {
    return db.query.exportRecords.findMany({ where: eq(exportRecords.sha256, sha256), orderBy: (t) => desc(t.createdAt) });
  }

  async list(limit: number, createdBy?: string): Promise<ExportRecord[]> {
    return db.query.exportRecords.findMany({ where: createdBy ? eq(exportRecords.createdBy, createdBy) : undefined, orderBy: (t) => desc(t.createdAt), limit });
  }
}
