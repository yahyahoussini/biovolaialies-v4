import { and, asc, desc, eq } from "drizzle-orm";
import { GENESIS_HASH, computeEventHash, hashPayload } from "../../domain/ledger/hash-chain";
import type { LedgerAppendInput, LedgerAppendResult, LedgerEvent, LedgerRepository } from "../../domain/ledger/types";
import { ConflictError } from "../../domain/shared/errors";
import { db } from "../db/client";
import { ledgerEvents } from "../db/schema";

const MAX_ATTEMPTS = 10;

/**
 * Appends from one server instance go through this queue one at a time, so an instance never
 * races itself for the next seq. Separate instances (serverless scale-out) can still race; the
 * UNIQUE(seq) constraint plus the retry loop below settles those.
 */
let appendQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = appendQueue.then(task, task);
  appendQueue = run.catch(() => undefined);
  return run;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isUniqueViolation(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error) + String((error as { cause?: unknown })?.cause ?? "");
  return /UNIQUE constraint failed/i.test(text);
}

/**
 * Append-only by construction: this class has no update or delete. Concurrency is handled by
 * the UNIQUE(seq) constraint — two writers that read the same head both compute seq N+1, one
 * insert wins, the other gets a constraint error and retries against the new head.
 */
export class DrizzleLedgerRepository implements LedgerRepository {
  async append(input: LedgerAppendInput): Promise<LedgerAppendResult> {
    return enqueue(() => this.appendNow(input));
  }

  private async appendNow(input: LedgerAppendInput): Promise<LedgerAppendResult> {
    const payloadHash = hashPayload(input.payload);
    const idempotencyKey = input.idempotencyKey ?? null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (idempotencyKey) {
        const existing = await this.findByIdempotencyKey(idempotencyKey);
        if (existing) return this.replayResult(existing, input, payloadHash);
      }

      const head = await this.head();
      const base = {
        id: crypto.randomUUID(),
        seq: (head?.seq ?? 0) + 1,
        eventType: input.eventType,
        objectType: input.objectType,
        objectId: input.objectId,
        actorKind: input.actorKind,
        actorId: input.actorId,
        source: input.source,
        occurredAt: input.occurredAt,
        recordedAt: new Date().toISOString(),
        schemaVersion: input.schemaVersion ?? 1,
        idempotencyKey,
        payloadHash,
        correctsEventId: input.correctsEventId ?? null,
        prevHash: head?.hash ?? GENESIS_HASH,
      };
      const row = { ...base, payload: input.payload, hash: computeEventHash(base) };

      try {
        const [inserted] = await db.insert(ledgerEvents).values(row).returning();
        return { event: inserted as LedgerEvent, duplicate: false };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_ATTEMPTS) throw error;
        // Lost a race on seq (or on the idempotency key) to another instance — back off, then
        // the loop re-reads the head / the key.
        await pause(5 + Math.random() * 20 * attempt);
      }
    }
    throw new Error("Ledger append failed after retries.");
  }

  /**
   * A replay is the SAME event sent again: every field the caller controls must match, not
   * just the payload. The same key on a different event is a client bug and gets a 409 instead
   * of being silently swallowed as a duplicate.
   */
  private replayResult(existing: LedgerEvent, input: LedgerAppendInput, payloadHash: string): LedgerAppendResult {
    const same =
      existing.payloadHash === payloadHash &&
      existing.eventType === input.eventType &&
      existing.objectType === input.objectType &&
      existing.objectId === input.objectId &&
      existing.actorId === input.actorId &&
      Date.parse(existing.occurredAt) === Date.parse(input.occurredAt) &&
      existing.schemaVersion === (input.schemaVersion ?? 1) &&
      existing.correctsEventId === (input.correctsEventId ?? null);
    if (!same) {
      throw new ConflictError("Cette clé d'idempotence a déjà été utilisée pour un événement différent.");
    }
    return { event: existing, duplicate: true };
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | null> {
    const row = await db.query.ledgerEvents.findFirst({ where: eq(ledgerEvents.idempotencyKey, key) });
    return (row as LedgerEvent | undefined) ?? null;
  }

  async listAll(): Promise<LedgerEvent[]> {
    return (await db.select().from(ledgerEvents).orderBy(asc(ledgerEvents.seq))) as LedgerEvent[];
  }

  async listRecent(limit: number): Promise<LedgerEvent[]> {
    return (await db.select().from(ledgerEvents).orderBy(desc(ledgerEvents.seq)).limit(limit)) as LedgerEvent[];
  }

  async listByObject(objectType: string, objectId: string): Promise<LedgerEvent[]> {
    return (await db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.objectType, objectType), eq(ledgerEvents.objectId, objectId)))
      .orderBy(asc(ledgerEvents.seq))) as LedgerEvent[];
  }

  async findById(id: string): Promise<LedgerEvent | null> {
    const row = await db.query.ledgerEvents.findFirst({ where: eq(ledgerEvents.id, id) });
    return (row as LedgerEvent | undefined) ?? null;
  }

  async findBySeq(seq: number): Promise<LedgerEvent | null> {
    const row = await db.query.ledgerEvents.findFirst({ where: eq(ledgerEvents.seq, seq) });
    return (row as LedgerEvent | undefined) ?? null;
  }

  async head(): Promise<LedgerEvent | null> {
    const [row] = await db.select().from(ledgerEvents).orderBy(desc(ledgerEvents.seq)).limit(1);
    return (row as LedgerEvent | undefined) ?? null;
  }
}
