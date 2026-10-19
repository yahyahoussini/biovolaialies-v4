import type { RuleState } from "../../shared/enums";
import { round1, sumOf, windowValues, recentMean, fr } from "./series";
import { clockMinutes, inDailyWindow, localMinutesOfDay, num } from "./settings";
import type { RuleEvaluator, RuleParams, Verdict } from "./types";

/** B02 × B01: an indicator, not an alarm — it says whether the birds can go out, nobody is paged. */
export const runAvailability: RuleEvaluator = {
  code: "PARCOURS_DISPONIBLE",
  label: "Disponibilité du parcours",
  raisesAlerts: false,
  evaluate(ctx) {
    const p = ctx.params("PARCOURS_DISPONIBLE");
    const probes = ctx.series.filter((s) => s.catalogRef === "B02" && s.sensorType === "HUMIDITE_SOL" && !s.contextOnly);
    if (probes.length === 0) return [];
    const values = probes.map((s) => ({ where: s.position ?? s.sensorCode ?? s.sensorId, v: recentMean(s, ctx.at, 60) })).filter((x) => x.v !== null) as { where: string; v: number }[];
    if (values.length === 0) return [];
    const rain = sumOf(windowValues(ctx.series.find((s) => s.catalogRef === "B01" && s.sensorType === "PLUIE"), ctx.at - 86_400_000, ctx.at));
    const wettest = Math.max(...values.map((x) => x.v));
    const wet = wettest >= num(p, "wetSoilPct") || rain >= num(p, "rain24hMm");
    const zoneId = probes[0].zoneId;
    return [
      {
        subjectKey: `zone:${zoneId ?? ctx.buildingId}`,
        subjectLabel: `Parcours — ${probes[0].zoneName ?? ctx.buildingName}`,
        state: wet ? "ALERTE" : "NORMAL",
        value: round1(wettest),
        unit: "%",
        high: num(p, "wetSoilPct"),
        lotId: ctx.occupantOf(zoneId, ctx.at)?.lotId ?? null,
        diagnosis: `${wet ? "Parcours indisponible" : "Parcours praticable"} : sol ${values.map((x) => `${x.where} ${round1(x.v)} %`).join(", ")} ; pluie ${fr(round1(rain))} mm sur 24 h.`,
        context: { gradient: values.map((x) => ({ where: x.where, value: round1(x.v) })), rain24hMm: round1(rain) },
      },
    ];
  },
};

/**
 * O01: access log tied to the building and the lot, an alert for an opening outside the
 * allowed hours, and for a door left open. Every opening since the last look is checked, so a
 * door opened and shut between two evaluations is not missed.
 */
export const accessOutOfHours: RuleEvaluator = {
  code: "ACCES_HORS_PLAGE",
  label: "Accès hors plage horaire",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("ACCES_HORS_PLAGE");
    const from = clockMinutes(String(p.openFrom));
    const to = clockMinutes(String(p.openTo));
    const offset = num(p, "utcOffsetMinutes");
    const out: Verdict[] = [];
    const doors = new Map<string, string>();
    for (const e of ctx.events) if (e.kind === "PORTE_OUVERTE" || e.kind === "PORTE_FERMEE" || e.kind === "ACCES_BADGE") doors.set(e.deviceId, e.deviceCode);
    for (const [deviceId, deviceCode] of doors) {
      const events = ctx.events.filter((e) => e.deviceId === deviceId && e.at <= ctx.at);
      if (events.length === 0) continue;
      const memory = ctx.memory("ACCES_HORS_PLAGE", `device:${deviceId}`);
      const seenUntil = typeof memory?.seenUntil === "number" ? memory.seenUntil : ctx.at - 10 * 60_000;
      const fresh = events.filter((e) => e.at > seenUntil && (e.kind === "PORTE_OUVERTE" || e.kind === "ACCES_BADGE"));
      const outOfHours = fresh.filter((e) => !inDailyWindow(localMinutesOfDay(e.at, offset), from, to));
      const doorEvents = events.filter((e) => e.kind === "PORTE_OUVERTE" || e.kind === "PORTE_FERMEE");
      const lastDoor = doorEvents[doorEvents.length - 1];
      const openFor = lastDoor?.kind === "PORTE_OUVERTE" ? (ctx.at - lastDoor.at) / 60_000 : 0;
      const badge = [...fresh].reverse().find((e) => e.badge)?.badge ?? null;
      const reasons: string[] = [];
      if (outOfHours.length) {
        const local = new Date(outOfHours[0].at + offset * 60_000).toISOString().slice(11, 16);
        reasons.push(`ouverture à ${local} hors de la plage ${p.openFrom}–${p.openTo}${badge ? ` (badge ${badge})` : " (sans badge)"}`);
      }
      if (openFor > num(p, "maxOpenMinutes")) reasons.push(`porte ouverte depuis ${Math.round(openFor)} min`);
      out.push({
        subjectKey: `device:${deviceId}`,
        subjectLabel: `Accès — ${deviceCode}`,
        state: reasons.length ? "ALERTE" : "NORMAL",
        value: Math.round(openFor),
        unit: "MIN",
        lotId: null,
        diagnosis: reasons.length ? `${reasons.join(" ; ")}.` : lastDoor?.kind === "PORTE_OUVERTE" ? "Porte ouverte dans la plage autorisée." : "Porte fermée.",
        context: { badge },
        memory: { seenUntil: ctx.at },
      });
    }
    return out;
  },
};

export interface SilenceInput {
  sensorId: string;
  label: string;
  gatewayId: string | null;
  gatewayLabel: string | null;
  buildingId: string;
  /** Uplink period promised by the catalogue; null for event-driven or protocol-driven channels, which are never "silent". */
  reportSeconds: number | null;
  lastReadingAt: number | null;
  installedAt: number;
}

export interface SilenceVerdict {
  subjectKey: string;
  subjectLabel: string;
  buildingId: string;
  state: RuleState;
  silentMinutes: number;
  diagnosis: string;
}

/**
 * Sensor health against the clock, not against the data. It runs on a schedule, because a
 * gateway that has gone quiet sends nothing to trigger anything. When every channel of a
 * gateway is silent, one verdict is given for the gateway instead of one per channel.
 */
export function silenceVerdicts(inputs: SilenceInput[], now: number, p: RuleParams): SilenceVerdict[] {
  const judged = inputs
    // A channel that has never transmitted is a commissioning matter (commissioning register), not a silence.
    .filter((i) => i.reportSeconds !== null && i.lastReadingAt !== null)
    .map((i) => {
      const threshold = Math.max(num(p, "minSilentMinutes"), (num(p, "silentAfterReports") * (i.reportSeconds as number)) / 60);
      const since = i.lastReadingAt as number;
      const silentMinutes = Math.max(0, (now - since) / 60_000);
      const state: RuleState = silentMinutes > num(p, "criticalMinutes") ? "CRITIQUE" : silentMinutes > threshold ? "ALERTE" : "NORMAL";
      return { ...i, silentMinutes, state };
    });
  const out: SilenceVerdict[] = [];
  const byGateway = new Map<string, typeof judged>();
  for (const j of judged) if (j.gatewayId) byGateway.set(j.gatewayId, [...(byGateway.get(j.gatewayId) ?? []), j]);
  const wholeGatewaySilent = new Set<string>();
  for (const [gatewayId, list] of byGateway) {
    const allSilent = list.length > 0 && list.every((j) => j.state !== "NORMAL");
    const minutes = Math.min(...list.map((j) => j.silentMinutes));
    const state: RuleState = allSilent ? (list.every((j) => j.state === "CRITIQUE") ? "CRITIQUE" : "ALERTE") : "NORMAL";
    if (allSilent) wholeGatewaySilent.add(gatewayId);
    out.push({
      subjectKey: `gateway:${gatewayId}`,
      subjectLabel: `Passerelle — ${list[0].gatewayLabel ?? gatewayId}`,
      buildingId: list[0].buildingId,
      state,
      silentMinutes: Math.round(minutes),
      diagnosis: allSilent
        ? `Aucune donnée de la passerelle depuis ${Math.round(minutes)} min (${list.length} voies). Réseau, alimentation ou passerelle : la régulation locale continue, l'historique est en tampon (30 jours).`
        : "La passerelle transmet.",
    });
  }
  for (const j of judged) {
    if (j.gatewayId && wholeGatewaySilent.has(j.gatewayId)) continue;
    out.push({
      subjectKey: `sensor:${j.sensorId}`,
      subjectLabel: j.label,
      buildingId: j.buildingId,
      state: j.state,
      silentMinutes: Math.round(j.silentMinutes),
      diagnosis: j.state === "NORMAL" ? "Le capteur transmet." : `Aucune mesure depuis ${Math.round(j.silentMinutes)} min alors que la passerelle transmet : capteur, câblage ou bus en défaut.`,
    });
  }
  return out;
}
