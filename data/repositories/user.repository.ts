import { count, eq } from "drizzle-orm";
import type { UserRepository } from "../../domain/identity/repositories";
import type { NewUser, User, UserSecurityFields } from "../../domain/identity/types";
import { db } from "../db/client";
import { users } from "../db/schema";

export class DrizzleUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    return row ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
    return row ?? null;
  }

  async list(): Promise<User[]> {
    return db.query.users.findMany({ orderBy: (t, { asc }) => asc(t.fullName) });
  }

  async create(input: NewUser): Promise<User> {
    const [row] = await db
      .insert(users)
      .values({ ...input, email: input.email.toLowerCase() })
      .returning();
    return row;
  }

  async update(id: string, patch: Partial<Pick<User, "role" | "scopeType" | "scopeId" | "active" | "authVersion">>): Promise<User> {
    const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  }

  async updateSecurity(id: string, patch: Partial<Pick<User, "passwordHash" | UserSecurityFields>>): Promise<User> {
    const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  }

  async count(): Promise<number> {
    const [row] = await db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async touchLastLogin(id: string, at: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, id));
  }
}
