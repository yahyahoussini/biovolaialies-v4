import type { ApiScope } from "../shared/enums";

export interface ApiClient {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type NewApiClient = Omit<ApiClient, "id" | "createdAt" | "lastUsedAt" | "revokedAt" | "active">;

export interface ApiClientRepository {
  create(input: NewApiClient): Promise<ApiClient>;
  findByKeyHash(hash: string): Promise<ApiClient | null>;
  findById(id: string): Promise<ApiClient | null>;
  list(): Promise<ApiClient[]>;
  touch(id: string, at: string): Promise<void>;
  revoke(id: string, at: string): Promise<ApiClient>;
}

/** The identity a valid key resolves to — what every /api/v1 handler receives. */
export interface ApiPrincipal {
  clientId: string;
  name: string;
  scopes: ApiScope[];
}
