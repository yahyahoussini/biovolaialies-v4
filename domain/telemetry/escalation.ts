import type { NotificationChannel, Role } from "../shared/enums";

/**
 * Escalation (document 3, lot 7): who is told, and who is told next if nobody acknowledges.
 * Acknowledging stops the climb; closing requires an intervention and an outcome. Delays are a
 * working assumption to set with the client, like every threshold here. The GSM alarm of
 * document 2 (L01) is NOT this path: it calls on its own, without the platform.
 */
export interface EscalationStep {
  level: number;
  afterMinutes: number;
  roles: Role[];
  channels: NotificationChannel[];
}

export const ESCALATION_POLICY: Record<"WARNING" | "CRITICAL", EscalationStep[]> = {
  CRITICAL: [
    { level: 1, afterMinutes: 0, roles: ["TECHNICIAN", "FARM_MANAGER"], channels: ["SMS", "EMAIL"] },
    { level: 2, afterMinutes: 15, roles: ["PRODUCER", "COOP_MANAGER"], channels: ["APPEL", "SMS"] },
    { level: 3, afterMinutes: 60, roles: ["SUPER_ADMIN"], channels: ["APPEL", "SMS"] },
  ],
  WARNING: [
    { level: 1, afterMinutes: 0, roles: ["TECHNICIAN", "FARM_MANAGER"], channels: ["EMAIL"] },
    { level: 2, afterMinutes: 120, roles: ["PRODUCER", "COOP_MANAGER"], channels: ["EMAIL", "SMS"] },
    { level: 3, afterMinutes: 480, roles: ["SUPER_ADMIN"], channels: ["EMAIL"] },
  ],
};

export function stepFor(severity: "WARNING" | "CRITICAL", level: number): EscalationStep | null {
  return ESCALATION_POLICY[severity].find((s) => s.level === level) ?? null;
}

/** When the next level falls due, counted from when the alert was raised; null at the top. */
export function nextEscalationAt(severity: "WARNING" | "CRITICAL", raisedAt: string, currentLevel: number): string | null {
  const next = stepFor(severity, currentLevel + 1);
  if (!next) return null;
  return new Date(Date.parse(raisedAt) + next.afterMinutes * 60_000).toISOString();
}

/** Levels that have fallen due at `now` and not yet been reached, in order. */
export function dueLevels(severity: "WARNING" | "CRITICAL", raisedAt: string, currentLevel: number, now: number): EscalationStep[] {
  return ESCALATION_POLICY[severity].filter((s) => s.level > currentLevel && Date.parse(raisedAt) + s.afterMinutes * 60_000 <= now);
}
