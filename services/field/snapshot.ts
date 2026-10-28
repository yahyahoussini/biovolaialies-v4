import { repositories } from "../../data/repositories";
import { displayedDeclaration, mortalityDayKey } from "../../domain/field/field";
import { formatAge, LINE_PURPOSE_LABEL, PHASE_LABEL, ageInDays } from "../../domain/production/lines";
import { farmDay, withdrawalMessage } from "../../domain/sanitary/health";
import type { LotStatus } from "../../domain/shared/enums";
import { AuthorizationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { SENSOR_TYPE_LABEL } from "../../domain/telemetry/labels";
import type { Session } from "../auth/session";
import { listLotsWithContext } from "../production/lot-queries";
import { listTransfers } from "../production/transfers";
import { activeHoldsOn } from "../quality/holds";
import { eggWithdrawalsOn, meatWithdrawalsAt } from "../sanitary/health";

/**
 * What a phone keeps to work without network (document 3, ch. 05): the lots it may enter data
 * on, the last values received with their time — so the person sees what is fresh and what is
 * not — the codes it can read, and the transfers waiting for its signature. Built from the
 * database only, within the person's scope, like every other view.
 */

const LIVE: LotStatus[] = ["CREE", "ACTIF", "EN_TRANSFERT", "SUSPENDU", "BLOQUE", "LIBERE"];
/** The readings worth a glance on a phone, one per measured quantity, most recent first. */
const GLANCE_SENSORS = ["TEMPERATURE", "HUMIDITE", "NH3", "CO2", "EAU", "PRESSION_DIFFERENTIELLE"] as const;

export interface Stamped<T> {
  at: string;
  value: T;
}

export interface FieldLot {
  id: string;
  code: string;
  bvuId: string | null;
  buildingId: string;
  buildingCode: string;
  farmName: string;
  purposeLabel: string | null;
  phaseLabel: string | null;
  age: string | null;
  status: LotStatus;
  currentPopulation: number;
  laying: boolean;
  onHold: boolean;
  latest: {
    mortality: Stamped<number> | null;
    weightKg: Stamped<number> | null;
    feedKg: Stamped<number> | null;
    waterL: Stamped<number> | null;
    health: Stamped<string> | null;
  };
  today: { declared: number | null; discrepancy: string | null };
  withdrawal: string | null;
  sensors: { label: string; value: number; unit: string; at: string }[];
}

export interface FieldReception {
  id: string;
  code: string;
  objectLabel: string;
  quantitySent: number;
  sentAt: string;
  senderName: string;
  from: string;
  to: string;
}

export interface FieldCode {
  /** As printed or encoded, upper case, without spaces. */
  code: string;
  kind: "LOT" | "SUBJECT" | "TRANSFER";
  id: string;
  lotId: string | null;
  label: string;
}

export interface FieldSnapshot {
  generatedAt: string;
  user: { id: string; fullName: string; role: string };
  can: { enter: boolean; care: boolean; receive: boolean };
  lots: FieldLot[];
  receptions: FieldReception[];
  codes: FieldCode[];
}

const norm = (code: string) => code.replace(/\s+/g, "").toUpperCase();

export async function buildFieldSnapshot(session: Session, now = new Date()): Promise<FieldSnapshot> {
  if (!can(session, "VIEW", "EVENTS")) throw new AuthorizationError("Ce compte n'a pas accès à la saisie terrain.");
  const user = await repositories.users.findById(session.userId);
  const at = now.toISOString();
  const today = farmDay(at);
  const lots = (await listLotsWithContext(session)).filter((l) => LIVE.includes(l.status));
  const lotIds = lots.map((l) => l.id);
  const subjects = await repositories.subjects.listByLots(lotIds);

  const fieldLots: FieldLot[] = [];
  for (const lot of lots) {
    const [phase, bvu, mortality, weights, feed, water, events, declarations, discrepancy, meat, eggs, devices, holds] = await Promise.all([
      repositories.lotPhases.current(lot.id),
      repositories.bvuIds.findByObject("LOT", lot.id),
      repositories.mortalityRecords.listByLot(lot.id),
      repositories.weightMeasurements.listByLot(lot.id),
      repositories.feedUsage.listByLot(lot.id),
      repositories.waterUsage.listByLot(lot.id),
      repositories.lotEvents.listByLot(lot.id),
      repositories.fieldEntries.listByDayKey(mortalityDayKey(lot.id, today)),
      repositories.fieldDiscrepancies.findByDayKey(mortalityDayKey(lot.id, today)),
      meatWithdrawalsAt(lot.id, at),
      eggWithdrawalsOn(lot.id, at),
      repositories.devices.listByBuilding(lot.buildingId),
      activeHoldsOn("LOT", lot.id),
    ]);
    const newest = <T extends { occurredAt: string }>(rows: T[]) => rows.reduce<T | null>((a, b) => (!a || b.occurredAt > a.occurredAt ? b : a), null);
    const lastMortality = newest(mortality.filter((m) => m.count > 0));
    const lastWeight = newest(weights);
    const lastFeed = newest(feed);
    const lastWater = newest(water);
    const lastHealth = newest(events.filter((e) => e.eventType === "VACCINATION" || e.eventType === "TRAITEMENT" || e.eventType === "OBSERVATION_SANITAIRE"));
    const healthLabel = lastHealth
      ? lastHealth.eventType === "VACCINATION"
        ? `Vaccination ${String((lastHealth.payload as { vaccine?: string }).vaccine ?? "")}`
        : lastHealth.eventType === "TRAITEMENT"
          ? `Traitement ${String((lastHealth.payload as { product?: string }).product ?? "")}`
          : `Observation : ${String((lastHealth.payload as { signs?: string }).signs ?? "").slice(0, 60)}`
      : null;
    const shown = displayedDeclaration(declarations.filter((e) => e.status !== "REFUSEE").map((e) => ({ authorId: e.authorId, count: (e.payload as { count: number }).count, capturedAt: e.capturedAt })));

    const sensors = devices.length ? await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id)) : [];
    const latest = sensors.length ? await repositories.readings.latestPerSensor(sensors.map((s) => s.id)) : new Map();
    const glance: FieldLot["sensors"] = [];
    for (const type of GLANCE_SENSORS) {
      const reading = sensors
        .filter((s) => s.sensorType === type)
        .map((s) => ({ s, r: latest.get(s.id) }))
        .filter((x): x is { s: (typeof sensors)[number]; r: { value: number; capturedAt: string; qualityFlag: string | null } } => !!x.r && !x.r.qualityFlag)
        .sort((a, b) => b.r.capturedAt.localeCompare(a.r.capturedAt))[0];
      if (reading) glance.push({ label: SENSOR_TYPE_LABEL[type] ?? type, value: reading.r.value, unit: reading.s.unit, at: reading.r.capturedAt });
    }

    const ageDays = lot.hatchedAt ? ageInDays(lot.hatchedAt, at) : null;
    fieldLots.push({
      id: lot.id,
      code: lot.code,
      bvuId: bvu?.bvuId ?? null,
      buildingId: lot.buildingId,
      buildingCode: lot.buildingCode,
      farmName: lot.farmName,
      purposeLabel: lot.purpose ? LINE_PURPOSE_LABEL[lot.purpose] : null,
      phaseLabel: phase ? PHASE_LABEL[phase.phase] : null,
      age: ageDays === null ? null : formatAge(ageDays),
      status: lot.status,
      currentPopulation: lot.currentPopulation,
      laying: lot.purpose === "PONTE" || lot.purpose === "REPRODUCTION",
      onHold: holds.length > 0,
      latest: {
        mortality: lastMortality ? { at: lastMortality.occurredAt, value: lastMortality.count } : null,
        weightKg: lastWeight ? { at: lastWeight.occurredAt, value: lastWeight.averageWeight } : null,
        feedKg: lastFeed ? { at: lastFeed.occurredAt, value: lastFeed.quantity } : null,
        waterL: lastWater ? { at: lastWater.occurredAt, value: lastWater.quantity } : null,
        health: lastHealth && healthLabel ? { at: lastHealth.occurredAt, value: healthLabel } : null,
      },
      today: { declared: shown?.count ?? null, discrepancy: discrepancy?.status === "OUVERT" ? discrepancy.reason : null },
      withdrawal: withdrawalMessage(meat, "meat") ?? withdrawalMessage(eggs, "eggs"),
      sensors: glance,
    });
  }

  const receptions: FieldReception[] = (await listTransfers(session))
    .filter((t) => t.canReceive)
    .map((t) => ({ id: t.id, code: t.code, objectLabel: t.objectLabel, quantitySent: t.quantitySent, sentAt: t.sentAt, senderName: t.senderName, from: t.sourceLabel, to: t.destinationLabel }));

  const codes: FieldCode[] = [];
  for (const lot of fieldLots) {
    codes.push({ code: norm(lot.code), kind: "LOT", id: lot.id, lotId: lot.id, label: lot.code });
    if (lot.bvuId) codes.push({ code: lot.bvuId, kind: "LOT", id: lot.id, lotId: lot.id, label: lot.code });
  }
  const lotCode = new Map(fieldLots.map((l) => [l.id, l.code]));
  for (const s of subjects) {
    const label = `Sujet ${s.visualId} (${lotCode.get(s.lotId) ?? "—"})`;
    codes.push({ code: norm(s.visualId), kind: "SUBJECT", id: s.id, lotId: s.lotId, label });
    codes.push({ code: s.bvuId, kind: "SUBJECT", id: s.id, lotId: s.lotId, label });
    if (s.rfidUid) codes.push({ code: norm(s.rfidUid), kind: "SUBJECT", id: s.id, lotId: s.lotId, label });
  }
  for (const r of receptions) {
    codes.push({ code: norm(r.code), kind: "TRANSFER", id: r.id, lotId: null, label: `Transfert ${r.code}` });
    const bvu = await repositories.bvuIds.findByObject("TRANSFER", r.id);
    if (bvu) codes.push({ code: bvu.bvuId, kind: "TRANSFER", id: r.id, lotId: null, label: `Transfert ${r.code}` });
  }

  return {
    generatedAt: at,
    user: { id: session.userId, fullName: user?.fullName ?? "—", role: session.role },
    can: { enter: can(session, "CREATE", "EVENTS"), care: can(session, "CREATE", "SANITARY"), receive: can(session, "EDIT", "LOTS") },
    lots: fieldLots.sort((a, b) => a.code.localeCompare(b.code)),
    receptions,
    codes,
  };
}
