import type { QualityCaseStatus, QualityHoldScope, QualityReason } from "../shared/enums";
import { err, ok, type Result } from "../shared/result";

export interface QualityCase {
  id: string;
  code: string;
  rootType: string;
  rootId: string;
  reason: QualityReason;
  description: string;
  scope: QualityHoldScope;
  status: QualityCaseStatus;
  evidenceRefs: string[];
  openedBy: string;
  openedAt: string;
  decidedBy: string | null;
  decisionJustification: string | null;
  decisionEvidenceRefs: string[] | null;
  decidedAt: string | null;
}

export type NewQualityCase = Omit<QualityCase, "id" | "decidedBy" | "decisionJustification" | "decisionEvidenceRefs" | "decidedAt">;

export interface QualityHoldItem {
  id: string;
  caseId: string;
  objectType: string;
  objectId: string;
  depth: number;
  active: boolean;
  createdAt: string;
}

export interface QualityCaseDecision {
  status: Exclude<QualityCaseStatus, "EN_BLOCAGE">;
  decidedBy: string;
  decisionJustification: string;
  decisionEvidenceRefs: string[];
  decidedAt: string;
}

export interface QualityCaseRepository {
  createWithItems(input: NewQualityCase, items: { objectType: string; objectId: string; depth: number }[]): Promise<QualityCase>;
  findById(id: string): Promise<QualityCase | null>;
  list(): Promise<QualityCase[]>;
  count(): Promise<number>;
  listItems(caseId: string): Promise<QualityHoldItem[]>;
  /** Active hold items on one object — a non-empty result means the object is blocked. */
  listActiveItemsFor(objectType: string, objectId: string): Promise<QualityHoldItem[]>;
  /** Records the decision and, for a release, deactivates every item of the case — atomically. */
  decide(caseId: string, decision: QualityCaseDecision): Promise<QualityCase>;
}

export const MIN_JUSTIFICATION_LENGTH = 20;

/**
 * Rule R10 as a pure check, so it is tested once and enforced identically everywhere:
 * an open case only; a different person from the one who opened it (four-eyes); a written
 * justification; at least one piece of evidence. The role check stays in the service, where
 * the permission matrix lives.
 */
export function validateDecision(
  qualityCase: Pick<QualityCase, "status" | "openedBy">,
  deciderId: string,
  justification: string,
  evidenceRefs: string[]
): Result<true> {
  if (qualityCase.status !== "EN_BLOCAGE") return err("Ce dossier est déjà clôturé.");
  if (qualityCase.openedBy === deciderId) {
    return err("Principe des quatre yeux : la décision doit être prise par une autre personne que celle qui a ouvert le blocage.");
  }
  if (justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
    return err(`La justification doit faire au moins ${MIN_JUSTIFICATION_LENGTH} caractères.`);
  }
  if (evidenceRefs.filter((r) => r.trim() !== "").length === 0) {
    return err("Au moins une preuve (référence de rapport, analyse, document) est requise.");
  }
  return ok(true);
}

/** Splits a free-text evidence field ("RAP-12; LAB-2026-044, photo") into clean references. */
export function parseEvidenceRefs(raw: string): string[] {
  return raw
    .split(/[;,\n]/)
    .map((r) => r.trim())
    .filter((r) => r !== "")
    .slice(0, 20);
}
