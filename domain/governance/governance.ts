/**
 * Governance records (document 3, ch. 08 and lot 12): who signed in, who failed to, and which exports
 * left the platform — each with what is needed to check it later, and nothing more.
 */

export const AUTH_OUTCOME = ["SUCCES", "ECHEC", "BLOQUE", "DECONNEXION", "BASCULE_DEMO"] as const;
export type AuthOutcome = (typeof AUTH_OUTCOME)[number];

export const AUTH_OUTCOME_LABEL: Record<AuthOutcome, string> = {
  SUCCES: "Connexion",
  ECHEC: "Échec",
  BLOQUE: "Bloquée (trop d'essais)",
  DECONNEXION: "Déconnexion",
  BASCULE_DEMO: "Changement de rôle (démonstration)",
};

/** Failed attempts allowed per account, and per device, within the window before sign-in is refused. */
export const MAX_FAILURES_PER_ACCOUNT = 5;
export const MAX_FAILURES_PER_CLIENT = 20;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export interface AuthEvent {
  id: string;
  at: string;
  email: string;
  userId: string | null;
  outcome: AuthOutcome;
  clientHash: string | null;
  userAgent: string | null;
  detail: string | null;
}

export interface ExportRecord {
  id: string;
  dataset: string;
  filename: string;
  filters: Record<string, string>;
  rows: number;
  bytes: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export interface AuthEventRepository {
  record(input: Omit<AuthEvent, "id">): Promise<AuthEvent>;
  countSince(field: "email" | "clientHash", value: string, outcome: AuthOutcome, since: string): Promise<number>;
  list(filters: { email?: string; outcome?: AuthOutcome }, limit: number): Promise<AuthEvent[]>;
}

export interface ExportRecordRepository {
  create(input: Omit<ExportRecord, "id">): Promise<ExportRecord>;
  findBySha256(sha256: string): Promise<ExportRecord[]>;
  list(limit: number, createdBy?: string): Promise<ExportRecord[]>;
}
