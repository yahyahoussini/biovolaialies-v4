import type { LedgerActorKind } from "../shared/enums";

export interface LedgerEvent {
  id: string;
  seq: number;
  eventType: string;
  objectType: string;
  objectId: string;
  actorKind: LedgerActorKind;
  actorId: string | null;
  source: string;
  occurredAt: string;
  recordedAt: string;
  payload: Record<string, unknown>;
  schemaVersion: number;
  idempotencyKey: string | null;
  payloadHash: string;
  correctsEventId: string | null;
  prevHash: string;
  hash: string;
}

/** What a caller supplies; the ledger itself fills in id, seq, recordedAt and the three hashes. */
export interface LedgerAppendInput {
  eventType: string;
  objectType: string;
  objectId: string;
  actorKind: LedgerActorKind;
  actorId: string | null;
  source: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  schemaVersion?: number;
  idempotencyKey?: string | null;
  correctsEventId?: string | null;
}

export interface LedgerAppendResult {
  event: LedgerEvent;
  /** True when the idempotency key had already been recorded with the same payload — nothing was written. */
  duplicate: boolean;
}

export interface LedgerRepository {
  append(input: LedgerAppendInput): Promise<LedgerAppendResult>;
  listAll(): Promise<LedgerEvent[]>;
  listRecent(limit: number): Promise<LedgerEvent[]>;
  listByObject(objectType: string, objectId: string): Promise<LedgerEvent[]>;
  findById(id: string): Promise<LedgerEvent | null>;
  findBySeq(seq: number): Promise<LedgerEvent | null>;
  head(): Promise<LedgerEvent | null>;
}
