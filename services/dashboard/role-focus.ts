import { repositories } from "../../data/repositories";
import { activeWithdrawals, farmDay } from "../../domain/sanitary/health";
import type { Lot } from "../../domain/production/types";
import type { Role } from "../../domain/shared/enums";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import type { Session } from "../auth/session";
import { getFieldActivity } from "../field/activity";
import { chicksAvailable } from "../../domain/hatchery/balance";
import { eggLotInTransit, eggsLostInTransfers, getHatcheryOverview } from "../hatchery/hatchery";
import { buildHierarchyIndex, isWithinScope } from "../identity/scope-check";
import { listAlertsInScope, listAnomaliesInScope } from "../intelligence/queries";
import { labWatch, listLabSamples } from "../lab/lab";
import { getMarkingOverview } from "../marking/marking";
import { listTransfers } from "../production/transfers";
import { listQualityCases } from "../quality/holds";
import { lotTreatments } from "../sanitary/health";
import { OCCUPIED_LOT_STATUSES } from "./selectors";
import { calibrationRegister } from "../telemetry/calibration";
import { telemetryOverview } from "../telemetry/queries";

/**
 * Document 3, ch. 07: "Six rôles, six vues. Un système qui montre tout à tout le monde n'est pas
 * généreux : il est illisible." Each view answers one question, with a handful of figures and the
 * work waiting for that person — everything read through the same scoped services as the rest of
 * the application, so a view can never show what its reader may not see.
 */

export type RoleViewKey = "DIRECTION" | "PRODUCTION" | "COUVOIR" | "VETERINAIRE" | "ELEVEUR" | "TECHNICIEN" | "QUALITE";

export const VIEW_OF_ROLE: Record<Role, RoleViewKey> = {
  SUPER_ADMIN: "DIRECTION",
  DIRECTION: "DIRECTION",
  AUDITOR: "DIRECTION",
  COOP_MANAGER: "PRODUCTION",
  FARM_MANAGER: "PRODUCTION",
  HATCHERY_MANAGER: "COUVOIR",
  VETERINARIAN: "VETERINAIRE",
  PRODUCER: "ELEVEUR",
  TECHNICIAN: "TECHNICIEN",
  QUALITY_MANAGER: "QUALITE",
};

export type FocusTone = "default" | "success" | "warning" | "critical";

export interface FocusTile {
  label: string;
  value: string;
  hint?: string;
  tone?: FocusTone;
  href?: string;
}

export interface FocusItem {
  label: string;
  detail: string;
  href: string | null;
  tone: "info" | "warning" | "critical" | "neutral" | "success";
  badge?: string;
}

export interface FocusList {
  title: string;
  empty: string;
  items: FocusItem[];
}

export interface RoleFocus {
  view: RoleViewKey;
  title: string;
  question: string;
  tiles: FocusTile[];
  lists: FocusList[];
}

const DAY = 86_400_000;
const LIVE = new Set<string>(OCCUPIED_LOT_STATUSES);
const n = (v: number) => v.toLocaleString("fr-FR");
const pct = (v: number | null, digits = 1) => (v === null ? "—" : `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`);
const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca", day: "numeric", month: "short" });

/** Runs a part of a view the reader may not have the rights for: missing rights mean an empty part, not a broken page. */
async function attempt<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

async function liveLotsInScope(session: Session): Promise<Lot[]> {
  if (!can(session, "VIEW", "LOTS")) return [];
  const [lots, index] = await Promise.all([repositories.lots.list(), buildHierarchyIndex()]);
  return lots.filter((l) => LIVE.has(l.status) && (isGlobalScope(session) || isWithinScope(session, index.building.get(l.buildingId) ?? {})));
}

async function mortalitySince(lots: Lot[], since: number): Promise<number> {
  let dead = 0;
  for (const lot of lots) for (const r of await repositories.mortalityRecords.listByLot(lot.id)) if (Date.parse(r.occurredAt) >= since) dead += r.count;
  return dead;
}

async function tableEggsSince(session: Session, since: number) {
  if (!can(session, "VIEW", "LOTS")) return { quantity: 0, saleable: 0, withdrawn: 0, withdrawnCodes: [] as { id: string; code: string; collectedOn: string }[] };
  const [eggs, lots, index] = await Promise.all([repositories.tableEggLots.list(), repositories.lots.list(), buildHierarchyIndex()]);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const visible = eggs.filter((e) => {
    const lot = lotById.get(e.lotId);
    return Date.parse(e.collectedOn) >= since && !!lot && (isGlobalScope(session) || isWithinScope(session, index.building.get(lot.buildingId) ?? {}));
  });
  const withdrawn = visible.filter((e) => e.status === "RETIRE");
  return {
    quantity: visible.reduce((s, e) => s + e.quantity, 0),
    saleable: visible.filter((e) => e.status !== "RETIRE" && e.status !== "DETRUIT").reduce((s, e) => s + e.saleable, 0),
    // Saleable eggs taken off sale — the figure the eggs page shows.
    withdrawn: withdrawn.reduce((s, e) => s + e.saleable, 0),
    withdrawnCodes: withdrawn.map((e) => ({ id: e.id, code: e.code, collectedOn: e.collectedOn })),
  };
}

async function withdrawalsNow(lots: Lot[], now: Date): Promise<FocusItem[]> {
  const items: FocusItem[] = [];
  for (const lot of lots) {
    const treatments = await lotTreatments(lot.id);
    for (const kind of ["meat", "eggs"] as const) {
      for (const w of activeWithdrawals(treatments, now.toISOString(), kind)) {
        items.push({
          label: `${lot.code} — ${w.product}`,
          detail: kind === "meat" ? `Pas d'abattage avant le ${date(w.until)}` : `Œufs hors vente jusqu'au ${date(w.until)}`,
          href: `/lots/${lot.id}`,
          tone: "warning",
          badge: kind === "meat" ? "Viande" : "Œufs",
        });
      }
    }
  }
  return items;
}

async function markingProof(session: Session, since: number) {
  if (!can(session, "VIEW", "MARKING")) return null;
  const overview = await getMarkingOverview(session);
  const runs = overview.runs.filter((r) => Date.parse(r.startedAt) >= since);
  const printed = runs.reduce((s, r) => s + r.printed, 0);
  return { rate: printed ? runs.reduce((s, r) => s + r.readOk, 0) / printed : null, printed, stopped: overview.runs.filter((r) => r.status === "ARRET_LECTURE") };
}

function labItems(rows: Awaited<ReturnType<typeof labWatch>>["toReview"]): FocusItem[] {
  return rows.map((s) => ({ label: `${s.code} — ${s.object?.code ?? "—"}`, detail: s.results.filter((r) => r.interpretation !== "NEGATIF" && r.interpretation !== "CONFORME").map((r) => `${r.analyte} : ${r.value}`).join(" ; ") || "Résultat à lire", href: `/laboratoire/${s.id}`, tone: "critical", badge: "À lire" }));
}

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

async function directionView(session: Session, now: Date): Promise<RoleFocus> {
  const since30 = now.getTime() - 30 * DAY;
  const lots = await liveLotsInScope(session);
  const birds = lots.reduce((s, l) => s + l.currentPopulation, 0);
  const dead = await mortalitySince(lots, since30);
  const eggs = await tableEggsSince(session, since30);
  const hatchery = await attempt(() => getHatcheryOverview(session), null);
  const hatched = (hatchery?.cycles ?? []).filter((c) => c.status === "ECLOS" && c.hatchedAt && Date.parse(c.hatchedAt) >= now.getTime() - 90 * DAY);
  const set = hatched.reduce((s, c) => s + c.eggsSet, 0);
  const cases = await attempt(() => listQualityCases(session), []);
  const open = cases.filter((c) => c.status === "EN_BLOCAGE");
  const proof = await attempt(() => markingProof(session, since30), null);
  const lab = await labWatch(session);
  const transfers = await attempt(() => listTransfers(session), []);
  const disputed = transfers.filter((t) => (t.status === "LITIGE" || t.status === "RECU_AVEC_ECART") && Date.parse(t.sentAt) >= since30);
  const farms = new Set(lots.map((l) => l.buildingId)).size;

  return {
    view: "DIRECTION",
    title: "Vue direction",
    question: "Que produit-on, que perd-on, et qu'est-ce qui menace la marchandise ?",
    tiles: [
      { label: "Sujets en élevage", value: n(birds), hint: `${n(lots.length)} lots occupés, ${n(farms)} bâtiments`, href: "/lots" },
      { label: "Mortalité sur 30 jours", value: pct(birds + dead ? dead / (birds + dead) : null, 2), hint: `${n(dead)} sujets`, tone: dead / Math.max(1, birds + dead) > 0.03 ? "warning" : "default" },
      { label: "Œufs collectés sur 30 jours", value: n(eggs.quantity), hint: `${n(eggs.saleable)} vendables, ${n(eggs.withdrawn)} retirés`, href: "/oeufs-consommation", tone: eggs.withdrawn > 0 ? "warning" : "default" },
      { label: "Taux d'éclosion (90 jours)", value: pct(set ? hatched.reduce((s, c) => s + (c.chicksHatched ?? 0), 0) / set : null), hint: `${n(hatched.length)} cycle${hatched.length > 1 ? "s" : ""} éclos`, href: "/couvoir" },
      { label: "Blocages qualité ouverts", value: n(open.length), tone: open.length > 0 ? "critical" : "success", href: "/qualite" },
      { label: "Preuve de marquage (30 jours)", value: pct(proof?.rate ?? null), hint: proof ? `${n(proof.printed)} codes relus ou rejetés` : "aucun marquage", href: "/marquage" },
    ],
    lists: [
      {
        title: "Ce qui attend une décision",
        empty: "Rien en attente.",
        items: [
          ...open.map((c): FocusItem => ({ label: `${c.code} — ${c.rootLabel}`, detail: c.description, href: `/qualite/${c.id}`, tone: "critical", badge: "Blocage" })),
          ...labItems(lab.toReview),
          ...disputed.map((t): FocusItem => ({ label: `${t.objectLabel} — ${t.sourceLabel} → ${t.destinationLabel}`, detail: t.status === "LITIGE" ? "Transfert en litige" : `Écart à la réception (${t.discrepancy ?? 0})`, href: `/transferts/${t.id}`, tone: t.status === "LITIGE" ? "critical" : "warning", badge: "Transfert" })),
        ],
      },
    ],
  };
}

async function productionView(session: Session, now: Date): Promise<RoleFocus> {
  const lots = await liveLotsInScope(session);
  const dead7 = await mortalitySince(lots, now.getTime() - 7 * DAY);
  const field = await attempt(() => getFieldActivity(session, now), null);
  const openDays = (field?.discrepancies ?? []).filter((d) => d.status === "OUVERT");
  const transfers = await attempt(() => listTransfers(session), []);
  const transit = transfers.filter((t) => t.status === "EN_TRANSIT");
  const proof = await attempt(() => markingProof(session, now.getTime() - 30 * DAY), null);
  const pendingObservations = (await repositories.sanitaryObservations.listPending()).filter((o) => lots.some((l) => l.id === o.lotId));

  return {
    view: "PRODUCTION",
    title: "Vue production",
    question: "Quels lots demandent une action aujourd'hui ?",
    tiles: [
      { label: "Sujets en élevage", value: n(lots.reduce((s, l) => s + l.currentPopulation, 0)), hint: `${n(lots.length)} lots occupés`, href: "/lots" },
      { label: "Mortalité sur 7 jours", value: n(dead7), hint: "sujets" },
      { label: "Jours en écart à arbitrer", value: n(openDays.length), tone: openDays.length ? "warning" : "success", href: "/saisies-terrain" },
      { label: "Transferts en route", value: n(transit.length), href: "/transferts" },
      { label: "Observations à examiner", value: n(pendingObservations.length), tone: pendingObservations.length ? "warning" : "default" },
      { label: "Lignes de marquage à l'arrêt", value: n(proof?.stopped.length ?? 0), tone: proof?.stopped.length ? "critical" : "default", href: "/marquage" },
    ],
    lists: [
      {
        title: "À faire",
        empty: "Rien en attente.",
        items: [
          ...openDays.map((d): FocusItem => ({ label: `${d.lotCode} — mortalité du ${date(`${d.day}T12:00:00Z`)}`, detail: d.declarations.map((x) => `${x.authorName} : ${x.count}`).join(", "), href: "/saisies-terrain", tone: "warning", badge: "Écart" })),
          ...(proof?.stopped ?? []).map((r): FocusItem => ({ label: `${r.code} — ${r.lineCode}`, detail: "Ligne arrêtée par le contrôle de lecture", href: `/marquage/${r.id}`, tone: "critical", badge: "Marquage" })),
          ...transit.map((t): FocusItem => ({ label: `${t.objectLabel}`, detail: `${t.sourceLabel} → ${t.destinationLabel}, parti le ${date(t.sentAt)}`, href: `/transferts/${t.id}`, tone: "info", badge: t.canReceive ? "À recevoir" : "En route" })),
        ],
      },
    ],
  };
}

async function hatcheryView(session: Session, now: Date): Promise<RoleFocus> {
  const hatchery = await attempt(() => getHatcheryOverview(session), null);
  const cycles = hatchery?.cycles ?? [];
  const recent = (iso: string | null) => !!iso && Date.parse(iso) >= now.getTime() - 30 * DAY;
  const incubating = cycles.filter((c) => c.status !== "ECLOS");
  const hatched = cycles.filter((c) => c.status === "ECLOS" && c.hatchedAt && Date.parse(c.hatchedAt) >= now.getTime() - 90 * DAY);
  const set = hatched.reduce((s, c) => s + c.eggsSet, 0);
  // Eggs still in the egg room: collected this month, not loaded, not lost or on the road — as the hatchery pages count them.
  const stock = [];
  for (const e of (hatchery?.eggLots ?? []).filter((x) => recent(x.collectedAt))) {
    if (await eggLotInTransit(e.id)) continue;
    const left = e.quantity - e.allocated - (await eggsLostInTransfers(e.id));
    if (left > 0) stock.push({ ...e, left });
  }
  // Chicks hatched this month and not yet gone: the "disponibles à sortir" of each cycle page.
  const waiting = cycles.filter((c) => c.status === "ECLOS" && recent(c.hatchedAt)).map((c) => ({ ...c, left: chicksAvailable(c.chicksHatched ?? 0, c.culls ?? 0, c.dispatched) })).filter((c) => c.left > 0);

  return {
    view: "COUVOIR",
    title: "Vue couvoir",
    question: "Qu'y a-t-il dans les incubateurs, et que faut-il faire aujourd'hui ?",
    tiles: [
      { label: "Cycles en cours", value: n(incubating.length), hint: `${n(incubating.reduce((s, c) => s + c.eggsSet, 0))} œufs`, href: "/couvoir" },
      { label: "Œufs en salle d'œufs", value: n(stock.reduce((s, e) => s + e.left, 0)), hint: "ramassés depuis moins de 30 jours" },
      { label: "Taux d'éclosion (90 jours)", value: pct(set ? hatched.reduce((s, c) => s + (c.chicksHatched ?? 0), 0) / set : null), hint: `${n(hatched.length)} cycle${hatched.length > 1 ? "s" : ""}` },
      { label: "Poussins à sortir", value: n(waiting.reduce((s, c) => s + c.left, 0)), hint: "éclos ce mois-ci, pas encore partis", tone: waiting.length ? "warning" : "default" },
    ],
    lists: [
      {
        title: "Incubateurs",
        empty: "Aucun cycle en cours.",
        items: incubating.map((c) => {
          const dayN = Math.floor((now.getTime() - Date.parse(c.setAt)) / DAY);
          return { label: `${c.code} — ${c.incubatorRef}`, detail: `J+${dayN}, ${n(c.eggsSet)} œufs ; éclosion attendue vers le ${date(new Date(Date.parse(c.setAt) + 21 * DAY).toISOString())} (21 jours)`, href: `/couvoir/cycles/${c.id}`, tone: c.status === "EN_INCUBATION" ? "info" : "neutral", badge: c.status === "EN_INCUBATION" ? "Mirage à faire" : "Miré" } satisfies FocusItem;
        }),
      },
      {
        title: "En attente au couvoir",
        empty: "Ni œufs en attente d'incubation, ni poussins en attente de départ.",
        items: [
          ...waiting.map((c): FocusItem => ({ label: `${c.code} — ${n(c.left)} poussins`, detail: `Éclos le ${date(c.hatchedAt!)}, ${n(c.dispatched)} déjà sortis`, href: `/couvoir/cycles/${c.id}`, tone: "warning", badge: "À sortir" })),
          ...stock.map((e): FocusItem => ({ label: `${e.code} — ${n(e.left)} œufs`, detail: `${e.flockCode}, ramassés il y a ${Math.floor((now.getTime() - Date.parse(e.collectedAt)) / DAY)} jours`, href: null, tone: "neutral", badge: "Salle d'œufs" })),
        ],
      },
    ],
  };
}

async function veterinarianView(session: Session, now: Date): Promise<RoleFocus> {
  const lots = await liveLotsInScope(session);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const pending = (await repositories.sanitaryObservations.listPending()).filter((o) => lotById.has(o.lotId) && o.observedBy !== session.userId);
  const withdrawals = await withdrawalsNow(lots, now);
  const lab = await labWatch(session);
  let treated = 0;
  for (const lot of lots) if ((await lotTreatments(lot.id)).some((t) => Date.parse(t.treatment.startedAt) >= now.getTime() - 14 * DAY)) treated++;

  return {
    view: "VETERINAIRE",
    title: "Vue vétérinaire",
    question: "Quels troupeaux sont malades, sous traitement ou en attente d'un résultat ?",
    tiles: [
      { label: "Observations à examiner", value: n(pending.length), tone: pending.length ? "warning" : "success" },
      { label: "Résultats à lire", value: n(lab.toReview.length), tone: lab.toReview.length ? "critical" : "success", href: "/laboratoire" },
      { label: "Au laboratoire", value: n(lab.pending.length), hint: "prélèvements sans résultat complet", href: "/laboratoire" },
      { label: "Délais d'attente en cours", value: n(withdrawals.length), tone: withdrawals.length ? "warning" : "default" },
      { label: "Lots traités sur 14 jours", value: n(treated) },
    ],
    lists: [
      {
        title: "À examiner",
        empty: "Aucune observation ni aucun résultat en attente.",
        items: [
          ...labItems(lab.toReview),
          ...pending.map((o): FocusItem => ({ label: `${lotById.get(o.lotId)?.code ?? "—"} — ${o.status === "ALERTE" ? "alerte" : o.status === "SURVEILLANCE" ? "surveillance" : "normal"}`, detail: `${o.notes} (${date(o.observedAt)})`, href: `/lots/${o.lotId}`, tone: o.status === "ALERTE" ? "critical" : "warning", badge: "Observation" })),
        ],
      },
      { title: "Délais d'attente en cours", empty: "Aucun délai d'attente en cours aujourd'hui.", items: withdrawals },
      {
        title: "Au laboratoire",
        empty: "Aucun prélèvement en attente.",
        items: lab.pending.map((s): FocusItem => ({ label: `${s.code} — ${s.object?.code ?? "—"}`, detail: `${s.laboratory}, prélevé le ${date(s.sampledAt)}`, href: `/laboratoire/${s.id}`, tone: "info" })),
      },
    ],
  };
}

async function farmerView(session: Session, now: Date): Promise<RoleFocus> {
  const lots = await liveLotsInScope(session);
  const today = farmDay(now.toISOString());
  const missing: FocusItem[] = [];
  for (const lot of lots.filter((l) => l.status === "ACTIF")) {
    const entered = (await repositories.mortalityRecords.listByLot(lot.id)).some((r) => farmDay(r.occurredAt) === today);
    if (!entered) missing.push({ label: `${lot.code}`, detail: "Mortalité du jour pas encore saisie (zéro compris)", href: "/terrain", tone: "warning", badge: "Saisie" });
  }
  const transfers = await attempt(() => listTransfers(session), []);
  const toReceive = transfers.filter((t) => t.status === "EN_TRANSIT" && t.canReceive);
  const withdrawals = await withdrawalsNow(lots, now);
  const alerts = await attempt(() => listAlertsInScope(session), []);
  const openAlerts = alerts.filter((a) => a.alert.status === "OPEN" || a.alert.status === "ACKNOWLEDGED");

  return {
    view: "ELEVEUR",
    title: "Ma ferme aujourd'hui",
    question: "Qu'est-ce que je dois faire aujourd'hui ?",
    tiles: [
      { label: "Mes sujets", value: n(lots.reduce((s, l) => s + l.currentPopulation, 0)), hint: `${n(lots.length)} lot${lots.length > 1 ? "s" : ""}`, href: "/lots" },
      { label: "Saisies du jour à faire", value: n(missing.length), tone: missing.length ? "warning" : "success", href: "/terrain" },
      { label: "Réceptions à signer", value: n(toReceive.length), tone: toReceive.length ? "warning" : "default", href: "/transferts" },
      { label: "Alertes ouvertes", value: n(openAlerts.length), tone: openAlerts.length ? "critical" : "success", href: "/alertes" },
    ],
    lists: [
      {
        title: "À faire aujourd'hui",
        empty: "Tout est saisi. Rien à signer.",
        items: [...toReceive.map((t): FocusItem => ({ label: t.objectLabel, detail: `De ${t.sourceLabel} : à compter et signer à l'arrivée`, href: `/transferts/${t.id}`, tone: "warning", badge: "Réception" })), ...missing],
      },
      { title: "Délais d'attente", empty: "Aucun délai d'attente en cours : œufs et sujets peuvent partir.", items: withdrawals },
      {
        title: "Résultats de laboratoire récents",
        empty: "Aucun résultat récent.",
        items: (await attempt(() => listLabSamples(session), [])).slice(0, 4).map((s): FocusItem => ({ label: `${s.code} — ${s.object?.code ?? "—"}`, detail: s.results.map((r) => `${r.analyte} : ${r.value}`).join(" ; ") || "En attente du laboratoire", href: `/laboratoire/${s.id}`, tone: s.adverse ? "critical" : s.results.length ? "success" : "info" })),
      },
    ],
  };
}

async function technicianView(session: Session, now: Date): Promise<RoleFocus> {
  const register = await attempt(() => calibrationRegister(session, now), []);
  const due = register.filter((r) => r.status === "ECHU" || r.status === "NON_CONFORME" || r.status === "JAMAIS");
  const soon = register.filter((r) => r.status === "A_ECHEANCE");
  const drifting = register.filter((r) => r.drifting);
  const sites = await attempt(() => telemetryOverview(session), []);
  const weak = sites.filter((s) => s.availability24h !== null && s.availability24h < 0.95);
  const anomalies = await attempt(() => listAnomaliesInScope(session), []);
  const toValidate = anomalies.filter((a) => a.status === "OPEN");
  const STATUS: Record<string, string> = { ECHU: "Étalonnage échu", NON_CONFORME: "Dernier étalonnage non conforme", JAMAIS: "Jamais étalonné", A_ECHEANCE: "Étalonnage bientôt dû" };

  return {
    view: "TECHNICIEN",
    title: "Vue technicien",
    question: "Les capteurs disent-ils vrai, et qu'est-ce qui attend une intervention ?",
    tiles: [
      { label: "Étalonnages à faire", value: n(due.length), hint: `${n(soon.length)} bientôt dus`, tone: due.length ? "warning" : "success", href: "/telemetrie" },
      { label: "Capteurs en dérive", value: n(drifting.length), tone: drifting.length ? "warning" : "success", href: "/telemetrie" },
      { label: "Bâtiments sous 95 % de disponibilité", value: n(weak.length), hint: "sur 24 heures", tone: weak.length ? "warning" : "success", href: "/telemetrie" },
      { label: "Anomalies à valider", value: n(toValidate.length), tone: toValidate.length ? "warning" : "default", href: "/anomalies" },
    ],
    lists: [
      {
        title: "Capteurs",
        empty: "Tous les capteurs sont à jour d'étalonnage et sans dérive.",
        items: [...due, ...drifting.filter((d) => !due.includes(d)), ...soon]
          .slice(0, 12)
          .map((r): FocusItem => ({ label: `${r.code} — ${r.label}`, detail: r.drifting ? `Dérive : erreurs ${r.errors.join(" → ")}` : (STATUS[r.status] ?? r.status), href: "/telemetrie", tone: r.status === "ECHU" || r.status === "NON_CONFORME" ? "critical" : "warning" })),
      },
      {
        title: "Anomalies à valider",
        empty: "Aucune anomalie ouverte.",
        items: toValidate.slice(0, 8).map((a): FocusItem => ({ label: a.explanation.what, detail: `${a.explanation.where} — ${a.explanation.byHowMuch}`, href: "/anomalies", tone: a.severity === "CRITICAL" ? "critical" : "warning" })),
      },
    ],
  };
}

async function qualityView(session: Session, now: Date): Promise<RoleFocus> {
  const since30 = now.getTime() - 30 * DAY;
  const cases = await attempt(() => listQualityCases(session), []);
  const open = cases.filter((c) => c.status === "EN_BLOCAGE");
  const eggs = await tableEggsSince(session, since30);
  const lab = await labWatch(session);
  const proof = await attempt(() => markingProof(session, since30), null);

  return {
    view: "QUALITE",
    title: "Vue qualité",
    question: "Qu'est-ce qui est bloqué, retiré ou douteux ?",
    tiles: [
      { label: "Blocages ouverts", value: n(open.length), tone: open.length ? "critical" : "success", href: "/qualite" },
      { label: "Œufs retirés de la vente (30 jours)", value: n(eggs.withdrawn), hint: `${n(eggs.withdrawnCodes.length)} collectes`, tone: eggs.withdrawn ? "warning" : "default", href: "/oeufs-consommation" },
      { label: "Résultats défavorables à lire", value: n(lab.toReview.length), tone: lab.toReview.length ? "critical" : "success", href: "/laboratoire" },
      { label: "Preuve de marquage (30 jours)", value: pct(proof?.rate ?? null), hint: `${n(proof?.stopped.length ?? 0)} ligne(s) à l'arrêt`, href: "/marquage" },
    ],
    lists: [
      {
        title: "Bloqué ou douteux",
        empty: "Rien de bloqué ni de douteux.",
        items: [
          ...open.map((c): FocusItem => ({ label: `${c.code} — ${c.rootLabel}`, detail: c.description, href: `/qualite/${c.id}`, tone: "critical", badge: "Blocage" })),
          ...labItems(lab.toReview),
          ...eggs.withdrawnCodes.map((e): FocusItem => ({ label: e.code, detail: `Collecte du ${date(e.collectedOn)} retirée de la vente (délai d'attente)`, href: `/oeufs-consommation/${e.id}`, tone: "warning", badge: "Retiré" })),
        ],
      },
    ],
  };
}

export async function getRoleFocus(session: Session, now = new Date()): Promise<RoleFocus> {
  switch (VIEW_OF_ROLE[session.role]) {
    case "DIRECTION":
      return directionView(session, now);
    case "PRODUCTION":
      return productionView(session, now);
    case "COUVOIR":
      return hatcheryView(session, now);
    case "VETERINAIRE":
      return veterinarianView(session, now);
    case "ELEVEUR":
      return farmerView(session, now);
    case "TECHNICIEN":
      return technicianView(session, now);
    case "QUALITE":
      return qualityView(session, now);
  }
}
