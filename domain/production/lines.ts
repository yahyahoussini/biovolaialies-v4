import type { EggType, LinePurpose, LotPhase, PhasePlanCheck } from "../shared/enums";

/**
 * Production lines of the client's handwritten flow, and the phases each one goes through.
 * Ages are in days since hatch. The figures are the diagram's own ("jusqu'à 6 semaines",
 * "de 6 semaines à 7 mois", "de 7 mois à 30 mois", "5,5 mois à 7 mois", "24 à 30 mois"); they are
 * data, editable on the lines screen, not constants buried in code.
 */

export interface PhasePlanStep {
  phase: LotPhase;
  /** Age window, in days, in which this phase normally ends. Null for the last phase: it ends with the exit. */
  endsBetween: [number, number] | null;
}

export interface ProductionLine {
  id: string;
  code: string;
  label: string;
  purpose: LinePurpose;
  parentLineCode: string | null;
  eggType: EggType | null;
  phasePlan: PhasePlanStep[];
  exitMinDays: number | null;
  exitMaxDays: number | null;
  exitLabel: string;
  source: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type NewProductionLine = Omit<ProductionLine, "id" | "createdAt" | "updatedAt" | "updatedBy">;

export interface LotPhaseRecord {
  id: string;
  lotId: string;
  phase: LotPhase;
  buildingId: string;
  startedAt: string;
  endedAt: string | null;
  ageDaysAtStart: number | null;
  planCheck: PhasePlanCheck;
  notes: string | null;
  actorId: string | null;
  createdAt: string;
}

export type NewLotPhaseRecord = Omit<LotPhaseRecord, "id" | "createdAt">;

const DAY_MS = 86_400_000;
/** Average month, so "7 mois" is the same number of days on every screen. */
export const MONTH_DAYS = 30.4375;
export const weeks = (n: number) => Math.round(n * 7);
export const months = (n: number) => Math.round(n * MONTH_DAYS);

/** Leeway around the diagram's ages: they are stated in weeks and months, not to the day. */
export const PHASE_TOLERANCE_DAYS = 7;
/** Day-old chicks are placed within their first days. */
const FIRST_PHASE_WINDOW: [number, number] = [0, 3];

export const PHASE_LABEL: Record<LotPhase, string> = {
  DEMARRAGE_CAGE: "Élevage en cages",
  ELEVAGE_SOL: "Élevage au sol",
  PRODUCTION_OAC: "Production d'œufs à couver",
  CROISSANCE: "Croissance (élevage de démarrage)",
  ELEVAGE_PARTENAIRE: "Élevage chez le partenaire",
  PONTE: "Ponte d'œufs de consommation",
  REFORME: "Réforme",
};

export const PLAN_CHECK_LABEL: Record<PhasePlanCheck, string> = {
  CONFORME: "Conforme au plan",
  AVANT_PLAN: "Plus tôt que le plan",
  APRES_PLAN: "Plus tard que le plan",
  HORS_PLAN: "Phase absente du plan de la ligne",
  SANS_PLAN: "Âge ou ligne inconnus",
};

export const LINE_PURPOSE_LABEL: Record<LinePurpose, string> = {
  REPRODUCTION: "Reproducteurs (œufs à couver)",
  CHAIR: "Chair",
  PONTE: "Ponte (œufs de consommation)",
};

const SOURCE_DIAGRAM = "Schéma « Système de traçabilité BVU » du client";

/** The five lines of the handwritten flow. Seeded once; edits are kept and audited. */
export const DEFAULT_LINES: NewProductionLine[] = [
  {
    code: "REPRO_CHAIR",
    label: "Reproducteurs — hybrides chair",
    purpose: "REPRODUCTION",
    parentLineCode: null,
    eggType: null,
    phasePlan: [
      { phase: "DEMARRAGE_CAGE", endsBetween: [weeks(6), weeks(6)] },
      { phase: "ELEVAGE_SOL", endsBetween: [months(7), months(7)] },
      { phase: "PRODUCTION_OAC", endsBetween: null },
    ],
    exitMinDays: null,
    exitMaxDays: months(30),
    exitLabel: "Réforme à 30 mois",
    source: SOURCE_DIAGRAM,
    active: true,
  },
  {
    code: "REPRO_PONTE",
    label: "Reproducteurs — hybrides pondeuses de consommation",
    purpose: "REPRODUCTION",
    parentLineCode: null,
    eggType: null,
    phasePlan: [
      { phase: "DEMARRAGE_CAGE", endsBetween: [weeks(6), weeks(6)] },
      { phase: "ELEVAGE_SOL", endsBetween: [months(7), months(7)] },
      { phase: "PRODUCTION_OAC", endsBetween: null },
    ],
    exitMinDays: null,
    exitMaxDays: months(30),
    exitLabel: "Réforme à 30 mois",
    source: SOURCE_DIAGRAM,
    active: true,
  },
  {
    code: "CHAIR_FERMIER",
    label: "Poulet fermier chair",
    purpose: "CHAIR",
    parentLineCode: "REPRO_CHAIR",
    eggType: null,
    phasePlan: [
      { phase: "CROISSANCE", endsBetween: [weeks(6), weeks(6)] },
      { phase: "ELEVAGE_PARTENAIRE", endsBetween: null },
    ],
    exitMinDays: months(5.5),
    exitMaxDays: months(7),
    exitLabel: "Abattage entre 5,5 et 7 mois",
    source: SOURCE_DIAGRAM,
    active: true,
  },
  {
    code: "PONDEUSE_BLANC",
    label: "Pondeuse — œuf de consommation blanc",
    purpose: "PONTE",
    parentLineCode: "REPRO_PONTE",
    eggType: "BLANC",
    phasePlan: [
      { phase: "CROISSANCE", endsBetween: [weeks(6), weeks(6)] },
      { phase: "ELEVAGE_PARTENAIRE", endsBetween: [months(5.5), months(7)] },
      { phase: "PONTE", endsBetween: null },
    ],
    exitMinDays: months(24),
    exitMaxDays: months(30),
    exitLabel: "Réforme entre 24 et 30 mois",
    source: SOURCE_DIAGRAM,
    active: true,
  },
  {
    code: "PONDEUSE_PISTACHE",
    label: "Pondeuse — œuf de consommation « Pistache »",
    purpose: "PONTE",
    parentLineCode: "REPRO_PONTE",
    eggType: "PISTACHE",
    phasePlan: [
      { phase: "CROISSANCE", endsBetween: [weeks(6), weeks(6)] },
      { phase: "ELEVAGE_PARTENAIRE", endsBetween: [months(5.5), months(7)] },
      { phase: "PONTE", endsBetween: null },
    ],
    exitMinDays: months(24),
    exitMaxDays: months(30),
    exitLabel: "Réforme entre 24 et 30 mois",
    source: SOURCE_DIAGRAM,
    active: true,
  },
];

export function ageInDays(hatchedAt: string | null, at: string): number | null {
  if (!hatchedAt) return null;
  return Math.floor((Date.parse(at) - Date.parse(hatchedAt)) / DAY_MS);
}

export function formatAge(days: number | null): string {
  if (days === null) return "âge inconnu";
  if (days < 0) return "pas encore éclos";
  if (days < 7 * 10) return `${days} j (${Math.floor(days / 7)} sem.)`;
  return `${days} j (${(days / MONTH_DAYS).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois)`;
}

/** Phases a line allows, in order — the plan's phases, then the reform for lines that end in one. */
export function allowedPhases(line: Pick<ProductionLine, "phasePlan" | "purpose">): LotPhase[] {
  const phases = line.phasePlan.map((s) => s.phase);
  return line.purpose === "CHAIR" ? phases : [...phases, "REFORME"];
}

/** Age window in which a phase normally starts: the end window of the step before it. */
export function startWindow(line: Pick<ProductionLine, "phasePlan" | "purpose" | "exitMinDays" | "exitMaxDays">, phase: LotPhase): [number, number] | null {
  if (phase === "REFORME") {
    if (line.purpose === "CHAIR" || line.exitMaxDays === null) return null;
    return [line.exitMinDays ?? 0, line.exitMaxDays];
  }
  const index = line.phasePlan.findIndex((s) => s.phase === phase);
  if (index < 0) return null;
  if (index === 0) return FIRST_PHASE_WINDOW;
  return line.phasePlan[index - 1].endsBetween;
}

/** How a phase start compares with the plan. Recorded with the phase; it never blocks the entry. */
export function checkPhaseStart(
  line: Pick<ProductionLine, "phasePlan" | "purpose" | "exitMinDays" | "exitMaxDays"> | null,
  phase: LotPhase,
  ageDays: number | null
): PhasePlanCheck {
  if (!line || ageDays === null) return "SANS_PLAN";
  if (!allowedPhases(line).includes(phase)) return "HORS_PLAN";
  const window = startWindow(line, phase);
  if (!window) return "HORS_PLAN";
  if (ageDays < window[0] - PHASE_TOLERANCE_DAYS) return "AVANT_PLAN";
  if (ageDays > window[1] + PHASE_TOLERANCE_DAYS) return "APRES_PLAN";
  return "CONFORME";
}

export interface DueAction {
  kind: "PHASE_SUIVANTE" | "SORTIE";
  label: string;
  dueFromDay: number;
  dueByDay: number;
  /** Days past the end of the window (0 while still inside it). */
  overdueDays: number;
}

/**
 * What the plan expects next for a lot of this age in this phase: move to the next phase, or
 * leave the line (slaughter, reform). Null while nothing is due yet.
 */
export function dueAction(line: Pick<ProductionLine, "phasePlan" | "purpose" | "exitMinDays" | "exitMaxDays" | "exitLabel">, phase: LotPhase | null, ageDays: number | null): DueAction | null {
  if (ageDays === null || phase === null || phase === "REFORME") return null;
  const index = line.phasePlan.findIndex((s) => s.phase === phase);
  if (index < 0) return null;
  const step = line.phasePlan[index];
  if (step.endsBetween) {
    const [from, by] = step.endsBetween;
    if (ageDays < from - PHASE_TOLERANCE_DAYS) return null;
    const next = line.phasePlan[index + 1]?.phase;
    return {
      kind: "PHASE_SUIVANTE",
      label: next ? `Passage en « ${PHASE_LABEL[next]} »` : "Fin de phase",
      dueFromDay: from,
      dueByDay: by,
      overdueDays: Math.max(0, ageDays - by - PHASE_TOLERANCE_DAYS),
    };
  }
  if (line.exitMaxDays === null) return null;
  const from = line.exitMinDays ?? line.exitMaxDays;
  if (ageDays < from - PHASE_TOLERANCE_DAYS) return null;
  return {
    kind: "SORTIE",
    label: line.exitLabel,
    dueFromDay: from,
    dueByDay: line.exitMaxDays,
    overdueDays: Math.max(0, ageDays - line.exitMaxDays - PHASE_TOLERANCE_DAYS),
  };
}

/** A plan is a sequence of distinct phases whose end windows are ordered and increasing. */
export function planError(plan: PhasePlanStep[], exitMinDays: number | null, exitMaxDays: number | null): string | null {
  if (plan.length === 0) return "Le plan doit comporter au moins une phase.";
  const seen = new Set<string>();
  let previousEnd = 0;
  for (const [i, step] of plan.entries()) {
    if (seen.has(step.phase)) return `La phase ${PHASE_LABEL[step.phase]} apparaît deux fois.`;
    seen.add(step.phase);
    const last = i === plan.length - 1;
    if (last && step.endsBetween) return "La dernière phase se termine par la sortie de la ligne : elle n'a pas de fenêtre de fin.";
    if (!last) {
      if (!step.endsBetween) return `La phase ${PHASE_LABEL[step.phase]} doit avoir une fenêtre de fin.`;
      const [from, to] = step.endsBetween;
      if (from > to) return `Fenêtre de fin inversée pour ${PHASE_LABEL[step.phase]}.`;
      if (from < previousEnd) return `La fin de ${PHASE_LABEL[step.phase]} précède celle de la phase précédente.`;
      previousEnd = to;
    }
  }
  if (exitMinDays !== null && exitMaxDays !== null && exitMinDays > exitMaxDays) return "Fenêtre de sortie inversée.";
  if (exitMaxDays !== null && exitMaxDays < previousEnd) return "La sortie est prévue avant la fin des phases.";
  return null;
}
