import { createHash } from "node:crypto";
import { repositories } from "../../data/repositories";
import type { ExportRecord } from "../../domain/governance/governance";
import { RESULT_INTERPRETATION_LABEL, SAMPLE_MATRIX_LABEL, SAMPLE_OBJECT_LABEL, SAMPLE_REASON_LABEL, SAMPLE_STATUS_LABEL } from "../../domain/lab/lab";
import { MARKING_RUN_STATUS_LABEL } from "../../domain/marking/marking";
import type { Lot } from "../../domain/production/types";
import { eggClearAt, meatClearAt, treatmentEndsAt, type Observation, type Treatment, type Vaccination } from "../../domain/sanitary/health";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can, type Action, type Module } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { csvDocument } from "../../lib/csv";
import type { Session } from "../auth/session";
import { searchAuditLog } from "../audit/queries";
import { bvuIdsFor } from "../identity/bvu-ids";
import { buildHierarchyIndex, isWithinScope } from "../identity/scope-check";
import { listLabSamples } from "../lab/lab";
import { appendLedgerEvent } from "../ledger/ledger";
import { getMarkingOverview } from "../marking/marking";
import { listTableEggLots } from "../production/table-eggs";
import { listTransfers } from "../production/transfers";

/**
 * Exports (document 3, lot 12 and the restitution layer: "ne produit rien qu'elle n'ait lu dans la
 * base — c'est ce qui rend un export opposable"). Each dataset is read through the same scoped reads
 * as the screens; each file served is registered with the SHA-256 of its exact bytes, in the export
 * register and in the chained ledger. Whoever holds the file later can check that it is the one the
 * platform produced, unchanged — the file itself never needs to be sent back, only its fingerprint.
 */

export const EXPORT_DATASET = ["lots", "mortalite", "oeufs", "sante", "laboratoire", "transferts", "marquage", "saisies-terrain", "audit"] as const;
export type ExportDataset = (typeof EXPORT_DATASET)[number];

export const EXPORT_DATASET_INFO: Record<ExportDataset, { label: string; description: string; right: [Action, Module] }> = {
  lots: { label: "Lots", description: "Chaque lot avec son identifiant BIOVOLAILLES, son site, ses dates et ses effectifs.", right: ["VIEW", "LOTS"] },
  mortalite: { label: "Mortalité", description: "Chaque déclaration de mortalité avec sa source, son auteur et son statut.", right: ["VIEW", "LOTS"] },
  oeufs: { label: "Œufs de consommation", description: "Chaque collecte calibrée : quantités, déclassement, statut de vente.", right: ["VIEW", "LOTS"] },
  sante: { label: "Registre sanitaire", description: "Vaccinations, traitements avec leurs délais d'attente, observations.", right: ["VIEW", "SANITARY"] },
  laboratoire: { label: "Laboratoire", description: "Prélèvements et résultats, une ligne par analyse, avec la lecture du vétérinaire.", right: ["VIEW", "LAB"] },
  transferts: { label: "Transferts", description: "Chaque mouvement compté et signé des deux côtés, avec ses écarts.", right: ["VIEW", "LOTS"] },
  marquage: { label: "Marquage des œufs", description: "Chaque campagne : codes attribués, imprimés, relus, rejetés.", right: ["VIEW", "MARKING"] },
  "saisies-terrain": { label: "Saisies terrain", description: "Chaque saisie reçue des téléphones, avec son sort et sa raison.", right: ["VIEW", "EVENTS"] },
  audit: { label: "Journal d'audit", description: "Qui a modifié quoi, quand, valeur avant et après, et pourquoi.", right: ["EXPORT", "AUDIT"] },
};

export function isExportDataset(value: string): value is ExportDataset {
  return (EXPORT_DATASET as readonly string[]).includes(value);
}

export function datasetsFor(session: Session): ExportDataset[] {
  return EXPORT_DATASET.filter((d) => {
    const [action, module] = EXPORT_DATASET_INFO[d].right;
    return can(session, action, module) || (d === "transferts" && can(session, "VIEW", "HATCHERY"));
  });
}

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : "");

async function lotsInScope(session: Session): Promise<Lot[]> {
  const [lots, index] = await Promise.all([repositories.lots.list(), buildHierarchyIndex()]);
  return lots.filter((l) => isGlobalScope(session) || isWithinScope(session, index.building.get(l.buildingId) ?? {}));
}

async function build(dataset: ExportDataset, session: Session): Promise<{ header: string[]; rows: (string | number | null)[][] }> {
  switch (dataset) {
    case "lots": {
      const [lots, buildings, farms] = await Promise.all([lotsInScope(session), repositories.buildings.list(), repositories.farms.list()]);
      const ids = await bvuIdsFor("LOT", lots.map((l) => l.id));
      return {
        header: ["Code", "Identifiant BIOVOLAILLES", "Ferme", "Bâtiment", "Espèce", "Souche", "Ligne", "Destination", "Statut", "Mise en place prévue", "Début", "Fin", "Effectif initial", "Effectif actuel", "Statut des données"],
        rows: lots.map((l) => {
          const b = buildings.find((x) => x.id === l.buildingId);
          return [l.code, ids.get(l.id) ?? "", farms.find((f) => f.id === b?.farmId)?.name ?? "", b?.code ?? "", l.species, l.breed, l.productionLine ?? "", l.purpose ?? "", l.status, iso(l.plannedStartAt), iso(l.startedAt), iso(l.endedAt), l.initialPopulation, l.currentPopulation, l.dataStatus];
        }),
      };
    }
    case "mortalite": {
      const [lots, users] = await Promise.all([lotsInScope(session), repositories.users.list()]);
      const rows: (string | number | null)[][] = [];
      for (const lot of lots) {
        for (const r of await repositories.mortalityRecords.listByLot(lot.id)) {
          rows.push([iso(r.occurredAt), lot.code, r.count, r.suspectedCause ?? "", r.causeValidated ? "oui" : "non", r.sourceType, users.find((u) => u.id === r.actorId)?.fullName ?? "", r.measurementMethod ?? "", r.deviceId ?? "", r.dataStatus]);
        }
      }
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return { header: ["Date", "Lot", "Morts", "Cause suspectée", "Cause validée", "Source", "Saisi par", "Méthode", "Appareil", "Statut des données"], rows };
    }
    case "oeufs": {
      const eggs = await listTableEggLots(session);
      return {
        header: ["Collecte", "Lot", "Ferme", "Collecté le", "Type", "Total", "Vendables", "Fêlés", "Sales", "Petits", "Déclassement (%)", "Statut", "Statut des données"],
        rows: eggs.map((e) => [e.code, e.lotCode, e.farmName, iso(e.collectedOn), e.eggType, e.quantity, e.saleable, e.cracked, e.dirty, e.small, e.downgradePct.toFixed(2), e.status, e.dataStatus]),
      };
    }
    case "sante": {
      const [lots, users] = await Promise.all([lotsInScope(session), repositories.users.list()]);
      const rows: (string | number | null)[][] = [];
      for (const lot of lots) {
        for (const e of await repositories.lotEvents.listByLot(lot.id)) {
          const by = users.find((u) => u.id === e.actorId)?.fullName ?? "";
          if (e.eventType === "VACCINATION") {
            const v = e.payload as Vaccination;
            rows.push([lot.code, iso(e.occurredAt), "Vaccination", `${v.vaccine} — ${v.disease}`, v.route, v.batchNumber ?? "", v.headcount ?? "", "", "", "", by]);
          } else if (e.eventType === "TRAITEMENT") {
            const t = e.payload as Treatment;
            rows.push([lot.code, iso(e.occurredAt), "Traitement", `${t.product} — ${t.indication}`, t.route, t.prescriptionRef ?? "", t.headcount ?? "", iso(treatmentEndsAt(t)), iso(meatClearAt(t)), iso(eggClearAt(t)), by]);
          } else if (e.eventType === "OBSERVATION_SANITAIRE") {
            const o = e.payload as Observation;
            rows.push([lot.code, iso(e.occurredAt), `Observation (${o.status.toLowerCase()})`, o.signs, "", "", o.affectedCount ?? "", "", "", "", by]);
          }
        }
      }
      rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      return { header: ["Lot", "Date", "Nature", "Détail", "Voie", "Lot de produit ou ordonnance", "Sujets", "Fin du traitement", "Viande : délai jusqu'au", "Œufs : délai jusqu'au", "Saisi par"], rows };
    }
    case "laboratoire": {
      const samples = await listLabSamples(session);
      const users = await repositories.users.list();
      const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.fullName ?? "") : "");
      const rows: (string | number | null)[][] = [];
      for (const s of samples) {
        const base = [s.code, SAMPLE_OBJECT_LABEL[s.objectType], s.object?.code ?? "", SAMPLE_MATRIX_LABEL[s.matrix], SAMPLE_REASON_LABEL[s.reason], iso(s.sampledAt), s.laboratory, iso(s.sentAt), SAMPLE_STATUS_LABEL[s.status]];
        if (s.results.length === 0) rows.push([...base, "", "", "", "", "", "", "", ""]);
        for (const r of s.results) rows.push([...base, r.analyte, r.method ?? "", r.value, RESULT_INTERPRETATION_LABEL[r.interpretation], iso(r.resultAt), r.reportRef ?? "", name(r.reviewedBy), r.reviewNote ?? ""]);
      }
      return { header: ["Prélèvement", "Prélevé sur", "Code", "Nature", "Motif", "Prélevé le", "Laboratoire", "Envoyé le", "Statut", "Analyse", "Méthode", "Résultat", "Interprétation", "Date du résultat", "Rapport", "Lu par", "Lecture"], rows };
    }
    case "transferts": {
      const transfers = await listTransfers(session);
      return {
        header: ["Code", "Objet", "De", "Vers", "Parti le", "Envoyé", "Signé au départ par", "Reçu le", "Reçu", "Morts à l'arrivée", "Écart", "Motif de l'écart", "Signé à l'arrivée par", "Statut", "Document", "Transporteur"],
        rows: transfers.map((t) => [t.code, t.objectLabel, t.sourceLabel, t.destinationLabel, iso(t.sentAt), t.quantitySent, t.senderName, iso(t.receivedAt), t.quantityReceived, t.deadOnArrival, t.discrepancy, t.discrepancyReason ?? "", t.receiverName ?? "", t.status, t.documentRef ?? "", t.transporter ?? ""]),
      };
    }
    case "marquage": {
      const { runs } = await getMarkingOverview(session);
      return {
        header: ["Campagne", "Ligne", "Ferme", "Voie", "Œufs marqués", "Début", "Fin", "Statut", "Codes attribués", "Imprimés", "Relus", "Rejetés", "Taux de relecture (%)"],
        rows: runs.map((r) => [r.code, r.lineCode, r.farmName, r.route, r.sourceCode, iso(r.startedAt), iso(r.endedAt), MARKING_RUN_STATUS_LABEL[r.status], r.allocated, r.printed, r.readOk, r.readKo, r.rate === null ? "" : (r.rate * 100).toFixed(2)]),
      };
    }
    case "saisies-terrain": {
      const [entries, lots, users, index] = await Promise.all([repositories.fieldEntries.listRecent(20_000), repositories.lots.list(), repositories.users.list(), buildHierarchyIndex()]);
      const lotById = new Map(lots.map((l) => [l.id, l]));
      const visible = entries.filter((e) => {
        if (isGlobalScope(session)) return true;
        const lot = e.lotId ? lotById.get(e.lotId) : undefined;
        return lot ? isWithinScope(session, index.building.get(lot.buildingId) ?? {}) : e.authorId === session.userId;
      });
      return {
        header: ["Reçue le", "Saisie le", "Auteur", "Appareil", "N° sur l'appareil", "Type", "Lot", "Statut", "Message", "Contenu"],
        rows: visible.map((e) => [iso(e.receivedAt), iso(e.capturedAt), users.find((u) => u.id === e.authorId)?.fullName ?? "", e.deviceId, e.deviceSeq, e.kind, e.lotId ? (lotById.get(e.lotId)?.code ?? "") : "", e.status, e.message ?? "", JSON.stringify(e.payload)]),
      };
    }
    case "audit": {
      const [entries, users, lots] = await Promise.all([searchAuditLog({}, session, 100_000), repositories.users.list(), repositories.lots.list()]);
      return {
        header: ["Date", "Acteur", "Objet", "Identifiant de l'objet", "Champ", "Avant", "Après", "Motif", "Lot"],
        rows: entries.map((e) => [iso(e.createdAt), e.actorId ? (users.find((u) => u.id === e.actorId)?.fullName ?? e.actorId) : "Système", e.entityType, e.entityId, e.field ?? "", e.oldValue ?? "", e.newValue ?? "", e.reason ?? "", e.relatedLotId ? (lots.find((l) => l.id === e.relatedLotId)?.code ?? "") : ""]),
      };
    }
  }
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ProducedExport {
  record: ExportRecord;
  body: Uint8Array<ArrayBuffer>;
}

/** Builds the file, then registers it — in the export register and the chained ledger — before handing it over. */
export async function produceExport(dataset: string, session: Session, now = new Date()): Promise<ProducedExport> {
  if (!isExportDataset(dataset)) throw new NotFoundError("Export", dataset);
  if (!datasetsFor(session).includes(dataset)) throw new AuthorizationError("Vous n'avez pas les droits pour cet export.");
  const { header, rows } = await build(dataset, session);
  const body = new TextEncoder().encode(csvDocument(header, rows));
  const digest = sha256(body);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const record = await repositories.exportRecords.create({
    dataset,
    filename: `biovolailles-${dataset}-${stamp}-${digest.slice(0, 8)}.csv`,
    filters: {},
    rows: rows.length,
    bytes: body.byteLength,
    sha256: digest,
    createdBy: session.userId,
    createdAt: now.toISOString(),
  });
  await appendLedgerEvent({
    eventType: "EXPORT",
    objectType: "export",
    objectId: record.id,
    actorKind: "USER",
    actorId: session.userId,
    source: "application",
    occurredAt: record.createdAt,
    payload: { dataset, rows: record.rows, bytes: record.bytes, sha256: digest, filename: record.filename },
    idempotencyKey: null,
  });
  return { record, body };
}

export interface ExportRow extends ExportRecord {
  createdByName: string;
  label: string;
}

/** The register: everyone sees their own exports; administration and audit see all of them. */
export async function listExports(session: Session, limit = 100): Promise<ExportRow[]> {
  const all = can(session, "VIEW", "AUDIT") && isGlobalScope(session);
  const [records, users] = await Promise.all([repositories.exportRecords.list(limit, all ? undefined : session.userId), repositories.users.list()]);
  return records.map((r) => ({ ...r, createdByName: users.find((u) => u.id === r.createdBy)?.fullName ?? "—", label: isExportDataset(r.dataset) ? EXPORT_DATASET_INFO[r.dataset].label : r.dataset }));
}

export type VerifyOutcome = { status: "IDENTIQUE"; record: ExportRow; others: number } | { status: "INCONNU" };

/**
 * Checks a fingerprint against the register. The file stays with its holder: only its SHA-256,
 * computed in their browser, is sent. A file changed by one character gives another fingerprint.
 */
export async function verifyExport(digest: string): Promise<VerifyOutcome> {
  const clean = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new ValidationError("Empreinte SHA-256 attendue : 64 caractères hexadécimaux.");
  const matches = await repositories.exportRecords.findBySha256(clean);
  if (matches.length === 0) return { status: "INCONNU" };
  const users = await repositories.users.list();
  const [first] = matches.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    status: "IDENTIQUE",
    record: { ...first, createdByName: users.find((u) => u.id === first.createdBy)?.fullName ?? "—", label: isExportDataset(first.dataset) ? EXPORT_DATASET_INFO[first.dataset].label : first.dataset },
    others: matches.length - 1,
  };
}
