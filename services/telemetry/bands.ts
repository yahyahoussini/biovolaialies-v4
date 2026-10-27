import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { Lot } from "../../domain/production/types";
import { ageDay, learnBand, seasonOf, type LearningSample } from "../../domain/telemetry/bands";
import type { ReferenceBand } from "../../domain/telemetry/types";
import { SEASON, SENSOR_TYPE, type SensorType } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

const FINISHED_LOT = new Set(["CLOTURE", "ABATTU", "TRANSFORME"]);

/**
 * Starting bands for beldi chicken. They are deliberately wide and say where they come from:
 * the client's documents give no figure, and document 3 says the first lots run on the poultry
 * technician's bands, tightened after each finished cycle. Replace them with the technician's.
 */
export const STARTING_BANDS: Omit<ReferenceBand, "id" | "createdAt" | "createdBy" | "decidedBy" | "decidedAt" | "supersedesId" | "lotsUsed" | "samples" | "learnedFrom">[] = [
  ...[
    [0, 7, 29, 35],
    [8, 14, 26, 32],
    [15, 21, 23, 30],
    [22, 42, 20, 28],
    [43, 150, 16, 30],
  ].map(([from, to, low, high]) => ({ sensorType: "TEMPERATURE" as const, ageDayFrom: from, ageDayTo: to, low, high, unit: "C" })),
  { sensorType: "HUMIDITE" as const, ageDayFrom: 0, ageDayTo: 150, low: 45, high: 80, unit: "%" },
  { sensorType: "CO2" as const, ageDayFrom: 0, ageDayTo: 150, low: 400, high: 3000, unit: "PPM" },
  ...[
    [0, 14, 0.04, 0.35],
    [15, 28, 0.2, 0.7],
    [29, 56, 0.45, 1.2],
    [57, 98, 0.9, 1.9],
    [99, 150, 1.3, 2.6],
  ].map(([from, to, low, high]) => ({ sensorType: "POIDS" as const, ageDayFrom: from, ageDayTo: to, low, high, unit: "KG" })),
].map((b) => ({
  ...b,
  productionLine: "CHAIR_FERMIER",
  season: "TOUTES" as const,
  source: "TECHNICIEN" as const,
  status: "ACTIVE" as const,
  version: 1,
  note: "Bande de départ large, à remplacer par celle du technicien avicole (document 3, ch. 4).",
}));

export async function seedStartingBands(createdBy: string | null): Promise<number> {
  if ((await repositories.bands.list()).length) return 0;
  for (const b of STARTING_BANDS) {
    await repositories.bands.create({ ...b, createdBy, decidedBy: null, decidedAt: null, supersedesId: null, lotsUsed: null, samples: null, learnedFrom: null });
  }
  return STARTING_BANDS.length;
}

export async function listBands(session: Session): Promise<ReferenceBand[]> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  return repositories.bands.list();
}

/** Which channel of which document 2 sensor feeds a band of this type. */
const LEARNING_SOURCE: Partial<Record<SensorType, string[]>> = { TEMPERATURE: ["A01"], HUMIDITE: ["A01"], CO2: ["A02"], POIDS: ["E01"] };

export interface LearningReport {
  bandId: string;
  label: string;
  outcome: "PROPOSEE" | "INSUFFISANT" | "INCHANGEE";
  detail: string;
  proposalId?: string;
}

/**
 * Learns, for every active band, a candidate from the farm's finished lots (document 3, ch. 4).
 * The candidate is a PROPOSEE version: it changes nothing until a technician accepts it.
 * Hours inside an alert closed as justified are left out; alerts closed with no outcome are
 * counted and reported, because they are what makes a history useless.
 */
export async function proposeLearnedBands(session: Session): Promise<{ reports: LearningReport[]; alertsWithoutOutcome: number }> {
  if (!can(session, "VALIDATE", "IOT")) throw new AuthorizationError("Seul un technicien ou la direction peut lancer l'apprentissage des bandes.");
  const bands = (await repositories.bands.list()).filter((b) => b.status === "ACTIVE");
  const lots = (await repositories.lots.list()).filter((l) => FINISHED_LOT.has(l.status) && l.startedAt);
  const sensors = await repositories.telemetrySensors.listAll();
  const alerts = await repositories.alerts.list();
  const anomalies = new Map((await repositories.anomalies.list()).map((a) => [a.id, a]));
  const closed = alerts.filter((a) => a.status === "RESOLVED" || a.status === "DISMISSED");
  const alertsWithoutOutcome = closed.filter((a) => !a.outcome).length;
  const confirmed = closed
    .filter((a) => a.outcome === "JUSTIFIEE")
    .map((a) => ({ lotId: anomalies.get(a.anomalyId)?.lotId ?? null, from: Date.parse(a.raisedAt), to: a.resolvedAt ? Date.parse(a.resolvedAt) : Date.now() }));

  const reports: LearningReport[] = [];
  const proposals = (await repositories.bands.list()).filter((b) => b.status === "PROPOSEE");
  const allHours = await repositories.aggregates.listByLots("1h", lots.map((l) => l.id));
  for (const band of bands) {
    const label = `${band.sensorType} ${band.productionLine} J${band.ageDayFrom}–J${band.ageDayTo} (${band.season})`;
    const refs = LEARNING_SOURCE[band.sensorType] ?? [];
    const sensorIds = sensors.filter((s) => s.sensorType === band.sensorType && s.catalogRef && refs.includes(s.catalogRef)).map((s) => s.id);
    const lineLots = lots.filter((l) => band.productionLine === "*" || l.productionLine === band.productionLine);
    const lotById = new Map<string, Lot>(lineLots.map((l) => [l.id, l]));
    const hours = allHours.filter((a) => a.lotId && lotById.has(a.lotId) && sensorIds.includes(a.sensorId) && a.count > 0);
    const samples: LearningSample[] = hours.map((h) => {
      const lot = lotById.get(h.lotId!)!;
      const t = Date.parse(h.bucketStart);
      return {
        lotId: lot.id,
        age: ageDay(lot.startedAt!, t),
        season: seasonOf(t),
        value: h.sum / h.count,
        duringConfirmedProblem: confirmed.some((c) => c.lotId === lot.id && t >= c.from && t <= c.to),
      };
    });
    const out = learnBand(samples, band);
    if (!out.ok) {
      reports.push({ bandId: band.id, label, outcome: "INSUFFISANT", detail: out.reason });
      continue;
    }
    if (Math.abs(out.band.low - band.low) < 0.01 && Math.abs(out.band.high - band.high) < 0.01) {
      reports.push({ bandId: band.id, label, outcome: "INCHANGEE", detail: "L'historique confirme la bande en vigueur." });
      continue;
    }
    // One pending proposal per band: a new run replaces an undecided older one.
    for (const p of proposals.filter((p) => p.supersedesId === band.id)) await repositories.bands.setStatus(p.id, "PROPOSEE", "REJETEE", session.userId);
    const proposal = await repositories.bands.create({
      sensorType: band.sensorType,
      productionLine: band.productionLine,
      ageDayFrom: band.ageDayFrom,
      ageDayTo: band.ageDayTo,
      season: band.season,
      low: out.band.low,
      high: out.band.high,
      unit: band.unit,
      source: "APPRIS",
      status: "PROPOSEE",
      version: band.version + 1,
      lotsUsed: out.band.lotsUsed,
      samples: out.band.samples,
      learnedFrom: out.band.learnedFrom,
      supersedesId: band.id,
      note: `Percentiles 5–95 de ${out.band.samples} heures sur ${out.band.lotsUsed} lots terminés${out.band.excluded ? ` ; ${out.band.excluded} heures d'incident confirmé écartées` : ""}.`,
      createdBy: session.userId,
      decidedBy: null,
      decidedAt: null,
    });
    reports.push({ bandId: band.id, label, outcome: "PROPOSEE", detail: `${band.low}–${band.high} → ${out.band.low}–${out.band.high}`, proposalId: proposal.id });
  }
  await recordAudit({
    actorId: session.userId,
    entityType: "reference_band",
    entityId: "apprentissage",
    field: null,
    oldValue: null,
    newValue: `${reports.filter((r) => r.outcome === "PROPOSEE").length} proposition(s), ${reports.filter((r) => r.outcome === "INSUFFISANT").length} fenêtre(s) sans historique suffisant`,
    reason: "Apprentissage des bandes de référence sur les lots terminés",
    relatedLotId: null,
    relatedEventId: null,
  });
  return { reports, alertsWithoutOutcome };
}

export const decideBandSchema = z.object({ proposalId: z.string().min(1), accept: z.boolean() });

/** Accepting puts the proposal in force and retires the band it replaces; both moves are compare-and-set. */
export async function decideBandProposal(input: unknown, session: Session): Promise<ReferenceBand> {
  if (!can(session, "VALIDATE", "IOT")) throw new AuthorizationError();
  const data = parseInput(decideBandSchema, input);
  const proposal = await repositories.bands.findById(data.proposalId);
  if (!proposal || proposal.status !== "PROPOSEE") throw new NotFoundError("Proposition de bande", data.proposalId);
  if (!data.accept) {
    const rejected = await repositories.bands.setStatus(proposal.id, "PROPOSEE", "REJETEE", session.userId);
    if (!rejected) throw new ConflictError("Cette proposition vient d'être tranchée.");
    await recordAudit({ actorId: session.userId, entityType: "reference_band", entityId: proposal.id, field: "status", oldValue: "PROPOSEE", newValue: "REJETEE", reason: "Proposition de bande refusée", relatedLotId: null, relatedEventId: null });
    return rejected;
  }
  if (proposal.supersedesId) {
    const retired = await repositories.bands.setStatus(proposal.supersedesId, "ACTIVE", "REMPLACEE", session.userId);
    if (!retired) throw new ConflictError("La bande en vigueur a changé entre-temps ; relancez l'apprentissage.");
  }
  const activated = await repositories.bands.setStatus(proposal.id, "PROPOSEE", "ACTIVE", session.userId);
  if (!activated) throw new ConflictError("Cette proposition vient d'être tranchée.");
  await recordAudit({
    actorId: session.userId,
    entityType: "reference_band",
    entityId: proposal.id,
    field: "status",
    oldValue: "PROPOSEE",
    newValue: `ACTIVE ${proposal.low}–${proposal.high} ${proposal.unit}`,
    reason: "Bande apprise mise en vigueur",
    relatedLotId: null,
    relatedEventId: null,
  });
  return activated;
}

export const editBandSchema = z.object({
  bandId: z.string().min(1).nullable().optional(),
  sensorType: z.enum(SENSOR_TYPE),
  productionLine: z.string().trim().min(1).max(40),
  ageDayFrom: z.number().int().min(0).max(1000),
  ageDayTo: z.number().int().min(0).max(1000),
  season: z.enum(SEASON),
  low: z.number().finite(),
  high: z.number().finite(),
  unit: z.string().trim().min(1).max(10),
  note: z.string().trim().min(10, "Indiquez d'où vient cette bande (10 caractères minimum).").max(500),
});

/** A technician's band, written from the screen: a new version in force, the previous one kept as REMPLACEE. */
export async function saveTechnicianBand(input: unknown, session: Session): Promise<ReferenceBand> {
  if (!can(session, "VALIDATE", "IOT")) throw new AuthorizationError();
  const data = parseInput(editBandSchema, input);
  if (data.ageDayTo < data.ageDayFrom) throw new ValidationError("La fin de la fenêtre d'âge précède son début.");
  if (data.high <= data.low) throw new ValidationError("La borne haute doit dépasser la borne basse.");
  let version = 1;
  let supersedesId: string | null = null;
  if (data.bandId) {
    const current = await repositories.bands.findById(data.bandId);
    if (!current || current.status !== "ACTIVE") throw new NotFoundError("Bande en vigueur", data.bandId);
    const retired = await repositories.bands.setStatus(current.id, "ACTIVE", "REMPLACEE", session.userId);
    if (!retired) throw new ConflictError("Cette bande vient d'être modifiée par quelqu'un d'autre.");
    version = current.version + 1;
    supersedesId = current.id;
  }
  const band = await repositories.bands.create({
    sensorType: data.sensorType,
    productionLine: data.productionLine,
    ageDayFrom: data.ageDayFrom,
    ageDayTo: data.ageDayTo,
    season: data.season,
    low: data.low,
    high: data.high,
    unit: data.unit,
    source: "TECHNICIEN",
    status: "ACTIVE",
    version,
    lotsUsed: null,
    samples: null,
    learnedFrom: null,
    supersedesId,
    note: data.note,
    createdBy: session.userId,
    decidedBy: session.userId,
    decidedAt: new Date().toISOString(),
  });
  await recordAudit({
    actorId: session.userId,
    entityType: "reference_band",
    entityId: band.id,
    field: "low/high",
    oldValue: supersedesId,
    newValue: `${band.low}–${band.high} ${band.unit}`,
    reason: data.note,
    relatedLotId: null,
    relatedEventId: null,
  });
  return band;
}
