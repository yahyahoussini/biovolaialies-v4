import type {
  DataStatus,
  EggType,
  IdAliasScheme,
  LotPhase,
  MeasurementSourceType,
  SubjectEventType,
  SubjectSex,
  SubjectStatus,
  TableEggLotStatus,
  TransferObject,
  TransferStatus,
} from "../shared/enums";
import type { ProvenanceFields } from "../shared/provenance";

/**
 * Movements, individually tracked birds and table eggs — the parts of the handwritten flow the
 * first model did not carry. Pure types and rules; the services own reads and writes.
 */

export interface Transfer {
  id: string;
  code: string;
  objectType: TransferObject;
  objectId: string;
  sourceBuildingId: string;
  destinationBuildingId: string;
  destinationLotId: string | null;
  destinationLotCode: string | null;
  destinationLineCode: string | null;
  phaseOnArrival: LotPhase | null;
  quantitySent: number;
  sentAt: string;
  sentBy: string;
  senderName: string;
  senderSignature: string;
  documentRef: string | null;
  transporter: string | null;
  vehicle: string | null;
  crates: number | null;
  notes: string | null;
  quantityReceived: number | null;
  deadOnArrival: number | null;
  receivedAt: string | null;
  receivedBy: string | null;
  receiverName: string | null;
  receiverSignature: string | null;
  discrepancy: number | null;
  discrepancyReason: string | null;
  status: TransferStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export type NewTransfer = Omit<Transfer, "id" | "createdAt" | "updatedAt">;

export interface Subject {
  id: string;
  bvuId: string;
  lotId: string;
  sex: SubjectSex;
  visualId: string;
  rfidUid: string | null;
  taggedAt: string;
  status: SubjectStatus;
  statusAt: string;
  statusReason: string | null;
  notes: string | null;
  dataStatus: DataStatus;
  actorId: string | null;
  createdAt: string;
}

export type NewSubject = Omit<Subject, "id" | "createdAt">;

export interface SubjectEvent {
  id: string;
  subjectId: string;
  eventType: SubjectEventType;
  value: number | null;
  unit: string | null;
  payload: Record<string, unknown>;
  attributionProof: string | null;
  occurredAt: string;
  actorId: string | null;
  deviceId: string | null;
  sourceType: MeasurementSourceType;
  dataStatus: DataStatus;
  createdAt: string;
}

export type NewSubjectEvent = Omit<SubjectEvent, "id" | "createdAt">;

export interface TableEggLot extends ProvenanceFields {
  id: string;
  code: string;
  lotId: string;
  collectedOn: string;
  eggType: EggType;
  quantity: number;
  saleable: number;
  cracked: number;
  dirty: number;
  small: number;
  status: TableEggLotStatus;
  createdAt: string;
}

export type NewTableEggLot = Omit<TableEggLot, "id" | "createdAt">;

export interface BvuIdRecord {
  bvuId: string;
  objectType: string;
  objectId: string;
  createdAt: string;
}

export interface IdentifierAlias {
  id: string;
  bvuId: string;
  scheme: IdAliasScheme;
  issuer: string;
  value: string;
  validFrom: string;
  validTo: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type NewIdentifierAlias = Omit<IdentifierAlias, "id" | "createdAt">;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  EN_TRANSIT: "En transit — à réceptionner",
  RECU_CONFORME: "Reçu, comptages concordants",
  RECU_AVEC_ECART: "Reçu avec écart",
  LITIGE: "En litige",
  ANNULE: "Annulé",
};

export const TRANSFER_OBJECT_LABEL: Record<TransferObject, string> = {
  LOT: "Lot d'animaux",
  CHICK_LOT: "Lot de poussins d'un jour",
  EGG_LOT: "Lot d'œufs à couver",
};

/**
 * The two counts of a movement. Birds found dead on arrival were counted, so they are not a gap;
 * the gap is what neither count explains. Any gap, either way, is kept and must be explained.
 */
export function receptionOutcome(sent: number, receivedAlive: number, deadOnArrival: number): { discrepancy: number; status: "RECU_CONFORME" | "RECU_AVEC_ECART" } {
  const discrepancy = sent - receivedAlive - deadOnArrival;
  return { discrepancy, status: discrepancy === 0 ? "RECU_CONFORME" : "RECU_AVEC_ECART" };
}

/** Case, accents and spacing do not make a different signature. */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A signature here is a deliberate act by the signed-in person: they type their own full name
 * under the count. It must match the name on their account.
 */
export function signatureMatches(typedName: string, accountName: string): boolean {
  const typed = normalizePersonName(typedName);
  return typed.length > 0 && typed === normalizePersonName(accountName);
}

export interface TableEggCounts {
  quantity: number;
  saleable: number;
  cracked: number;
  dirty: number;
  small: number;
}

/** Every egg collected falls in exactly one class. */
export function tableEggCountError(c: TableEggCounts): string | null {
  for (const [label, v] of [
    ["Œufs collectés", c.quantity],
    ["Œufs vendables", c.saleable],
    ["Œufs fêlés", c.cracked],
    ["Œufs sales", c.dirty],
    ["Petits œufs", c.small],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) return `${label} : nombre entier positif attendu.`;
  }
  if (c.quantity === 0) return "Une collecte compte au moins un œuf.";
  const sum = c.saleable + c.cracked + c.dirty + c.small;
  if (sum !== c.quantity) return `Les classes (${sum}) ne font pas le total collecté (${c.quantity}) : chaque œuf doit être classé une fois.`;
  return null;
}

/** Share of collected eggs that cannot be sold as first choice. */
export function downgradeRate(c: TableEggCounts): number {
  return c.quantity > 0 ? (c.cracked + c.dirty + c.small) / c.quantity : 0;
}

/**
 * An RFID UID or a ring number names one bird for life. One that was released (lost tag, dead
 * bird) can only be issued again through the recorded release procedure.
 */
export function normalizeTag(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}
