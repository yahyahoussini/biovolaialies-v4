import type { Destination, NewDestination, NewProduct, NewQrToken, NewRelation, Product, QrToken, Relation } from "./types";

/** Fully implemented against Drizzle as of Phase 7 — the generic relation graph (ARCHITECTURE.md §6b). */
export interface RelationRepository {
  listFrom(fromType: string, fromId: string): Promise<Relation[]>;
  listTo(toType: string, toId: string): Promise<Relation[]>;
  /** Exact-match lookup — how duplicate relations are detected before creating a new one. */
  findExact(fromType: string, fromId: string, relationType: string, toType: string, toId: string): Promise<Relation | null>;
  create(input: NewRelation): Promise<Relation>;
}

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findByCode(code: string): Promise<Product | null>;
  listByTransformationBatch(transformationBatchId: string): Promise<Product[]>;
  create(input: NewProduct): Promise<Product>;
  list(): Promise<Product[]>;
}

export interface DestinationRepository {
  findById(id: string): Promise<Destination | null>;
  findByCode(code: string): Promise<Destination | null>;
  list(): Promise<Destination[]>;
  create(input: NewDestination): Promise<Destination>;
}

export interface QrTokenRepository {
  findById(id: string): Promise<QrToken | null>;
  findByToken(token: string): Promise<QrToken | null>;
  listByLot(lotId: string): Promise<QrToken[]>;
  listByProduct(productId: string): Promise<QrToken[]>;
  create(input: NewQrToken): Promise<QrToken>;
  setActive(id: string, active: boolean): Promise<QrToken>;
}
