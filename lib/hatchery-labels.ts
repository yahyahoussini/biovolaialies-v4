import type { HatchCycleStatus } from "../domain/shared/enums";
import type { BadgeTone } from "./status-colors";

export const HATCH_CYCLE_STATUS_LABEL: Record<HatchCycleStatus, string> = {
  EN_INCUBATION: "En incubation",
  MIRE: "Miré",
  ECLOS: "Éclos",
};

export const HATCH_CYCLE_STATUS_TONE: Record<HatchCycleStatus, BadgeTone> = {
  EN_INCUBATION: "info",
  MIRE: "warning",
  ECLOS: "success",
};

export function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}
