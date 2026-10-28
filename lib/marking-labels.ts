import type { MarkingRoute, MarkingRunStatus } from "@/domain/marking/marking";

export const RUN_TONE: Record<MarkingRunStatus, "info" | "critical" | "neutral"> = { EN_COURS: "info", ARRET_LECTURE: "critical", CLOS: "neutral" };
export const ROUTE_SHORT: Record<MarkingRoute, string> = { A_COUVER: "A — à couver", B_CONSOMMATION: "B — consommation" };
export const ratePct = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);
