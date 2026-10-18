import { and, count, eq, gte } from "drizzle-orm";
import type { Lead, LeadRepository, NewLead } from "../../domain/leads/types";
import type { LeadStatus } from "../../domain/shared/enums";
import { db } from "../db/client";
import { leads } from "../db/schema";

export class DrizzleLeadRepository implements LeadRepository {
  async create(input: NewLead): Promise<Lead> {
    const [row] = await db.insert(leads).values(input).returning();
    return row;
  }

  async findById(id: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({ where: eq(leads.id, id) });
    return row ?? null;
  }

  async list(): Promise<Lead[]> {
    return db.query.leads.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) });
  }

  async update(id: string, changes: { status?: LeadStatus; notes?: string | null }): Promise<Lead> {
    const [row] = await db
      .update(leads)
      .set({ ...changes, updatedAt: new Date().toISOString() })
      .where(eq(leads.id, id))
      .returning();
    return row;
  }

  async countSince(email: string, sinceIso: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.email, email), gte(leads.createdAt, sinceIso)));
    return row?.value ?? 0;
  }
}
