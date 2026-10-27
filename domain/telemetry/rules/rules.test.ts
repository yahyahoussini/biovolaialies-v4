import { describe, expect, it } from "vitest";
import type { SensorType, ZoneKind } from "../../shared/enums";
import type { DecisionRule } from "../catalog";
import type { ReferenceBand } from "../types";
import { weighingStats } from "./birds-hatchery";
import { EVALUATORS } from "./index";
import { runRules, stateKey, type SubjectState } from "./runner";
import type { ChannelSeries } from "./series";
import { defaultParams, mergeParams } from "./settings";
import { silenceVerdicts } from "./site";
import type { EvalContext, OccupantInfo, RuleEvaluator, SiteEventPoint } from "./types";

const T0 = Date.parse("2026-08-10T00:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

function series(
  sensorId: string,
  sensorType: SensorType,
  catalogRef: string,
  fn: (t: number) => number | null,
  opts: { every?: number; from?: number; to?: number; zoneId?: string; zoneKind?: ZoneKind; position?: string; unit?: string } = {}
): ChannelSeries {
  const every = opts.every ?? 2 * MIN;
  const times: number[] = [];
  const values: number[] = [];
  for (let t = opts.from ?? T0; t <= (opts.to ?? T0 + 4 * 24 * HOUR); t += every) {
    const v = fn(t);
    if (v === null) continue;
    times.push(t);
    values.push(v);
  }
  return { sensorId, sensorCode: sensorId, sensorType, catalogRef, zoneId: opts.zoneId ?? "z1", zoneKind: opts.zoneKind ?? "ELEVAGE", zoneName: "Zone 1", position: opts.position ?? null, unit: opts.unit ?? "C", times, values };
}

const lot: OccupantInfo = { lotId: "lot-1", lotCode: "L-1", productionLine: "CHAIR_FERMIER", startedAt: "2026-07-20T00:00:00Z" };

function ctxAt(at: number, s: ChannelSeries[], extra: Partial<EvalContext> = {}): EvalContext {
  return {
    buildingId: "b1",
    buildingName: "Bâtiment 1",
    at,
    series: s,
    events: [],
    bands: [],
    occupantOf: () => lot,
    params: (rule: DecisionRule) => defaultParams(rule),
    previousState: () => "NORMAL",
    memory: () => null,
    ...extra,
  };
}

const evaluator = (code: DecisionRule): RuleEvaluator => EVALUATORS.find((e) => e.code === code)!;

const tempBand: ReferenceBand = {
  id: "band-t",
  sensorType: "TEMPERATURE",
  productionLine: "CHAIR_FERMIER",
  ageDayFrom: 0,
  ageDayTo: 150,
  season: "TOUTES",
  low: 20,
  high: 28,
  unit: "C",
  source: "TECHNICIEN",
  status: "ACTIVE",
  version: 1,
  lotsUsed: null,
  samples: null,
  learnedFrom: null,
  supersedesId: null,
  note: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  decidedBy: null,
  decidedAt: null,
};

describe("learned band (A01)", () => {
  it("judges against the band of the lot's age and returns to normal only with a margin", () => {
    const hot = series("t1", "TEMPERATURE", "A01", (t) => (t >= T0 + HOUR && t < T0 + 2 * HOUR ? 29 : 24));
    const e = evaluator("BANDE_APPRISE");
    expect(e.evaluate(ctxAt(T0 + 30 * MIN, [hot], { bands: [tempBand] }))[0].state).toBe("NORMAL");
    const out = e.evaluate(ctxAt(T0 + 90 * MIN, [hot], { bands: [tempBand] }))[0];
    expect(out.state).toBe("ALERTE");
    expect(out.bandId).toBe("band-t");
    expect(out.diagnosis).toContain("au-dessus de la bande 20–28");
    // 27.9 is inside the band but within the 5 % hysteresis margin: still ALERTE after an alert.
    const edge = series("t1", "TEMPERATURE", "A01", () => 27.9);
    expect(e.evaluate(ctxAt(T0 + 3 * HOUR, [edge], { bands: [tempBand], previousState: () => "ALERTE" }))[0].state).toBe("ALERTE");
    expect(e.evaluate(ctxAt(T0 + 3 * HOUR, [edge], { bands: [tempBand] }))[0].state).toBe("NORMAL");
  });

  it("says it does not judge when no lot is in the zone or no band covers the age", () => {
    const s = series("t1", "TEMPERATURE", "A01", () => 40);
    expect(evaluator("BANDE_APPRISE").evaluate(ctxAt(T0 + HOUR, [s], { bands: [tempBand], occupantOf: () => null }))[0].diagnosis).toContain("aucun lot");
    expect(evaluator("BANDE_APPRISE").evaluate(ctxAt(T0 + HOUR, [s], { bands: [] }))[0].diagnosis).toContain("aucune bande");
  });

  it("goes critical when far outside the band", () => {
    const s = series("t1", "TEMPERATURE", "A01", () => 34);
    expect(evaluator("BANDE_APPRISE").evaluate(ctxAt(T0 + HOUR, [s], { bands: [tempBand] }))[0].state).toBe("CRITIQUE");
  });
});

describe("zone drift (A01)", () => {
  it("flags the spread between zones", () => {
    const a = series("a", "TEMPERATURE", "A01", () => 24, { position: "8,5 m" });
    const b = series("b", "TEMPERATURE", "A01", () => 27, { position: "41,5 m" });
    const v = evaluator("DERIVE_ENTRE_ZONES").evaluate(ctxAt(T0 + HOUR, [a, b]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("41,5 m");
  });
});

describe("CO₂ × ventilation (A02)", () => {
  const co2 = series("c", "CO2", "A02", () => 3500, { unit: "PPM" });
  it("reads a breakdown when the fans are stopped", () => {
    const fans = series("f", "VENTILATION", "PLC", () => 0, { unit: "%" });
    expect(evaluator("CO2_VENTILATION").evaluate(ctxAt(T0 + HOUR, [co2, fans]))[0].state).toBe("CRITIQUE");
  });
  it("reads undersizing when the fans are flat out", () => {
    const fans = series("f", "VENTILATION", "PLC", () => 100, { unit: "%" });
    const v = evaluator("CO2_VENTILATION").evaluate(ctxAt(T0 + HOUR, [co2, fans]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("sous-dimensionnement");
  });
});

describe("NH₃ cumulative exposure (A03)", () => {
  it("alerts on the threshold, goes critical on the cumulated time", () => {
    // 30 ppm for 3 hours, then back to 10.
    const nh3 = series("n", "NH3", "A03", (t) => (t >= T0 + HOUR && t < T0 + 4 * HOUR ? 30 : 10), { unit: "PPM" });
    const e = evaluator("NH3_EXPOSITION");
    expect(e.evaluate(ctxAt(T0 + 90 * MIN, [nh3]))[0].state).toBe("ALERTE");
    const after = e.evaluate(ctxAt(T0 + 3.5 * HOUR, [nh3]))[0];
    expect(after.state).toBe("CRITIQUE");
    expect(after.value).toBeGreaterThanOrEqual(120);
    // Back under the threshold, but the 24 h exposure still exceeds the tolerance.
    expect(e.evaluate(ctxAt(T0 + 5 * HOUR, [nh3]))[0].state).toBe("CRITIQUE");
    // A day later the exposure has left the window.
    expect(e.evaluate(ctxAt(T0 + 29 * HOUR, [nh3]))[0].state).toBe("NORMAL");
  });

  it("does not count a data gap as exposure", () => {
    const nh3 = series("n", "NH3", "A03", (t) => (t < T0 + HOUR ? 30 : null), { unit: "PPM", to: T0 + HOUR });
    const v = evaluator("NH3_EXPOSITION").evaluate(ctxAt(T0 + 10 * HOUR, [nh3]))[0];
    expect(v.value).toBeLessThanOrEqual(64);
  });
});

describe("water (C01 × C03 × C05, C02, C04)", () => {
  const usual = (t: number) => ((t - T0) % (24 * HOUR) < 12 * HOUR ? 20 : 10);
  it("orients a drop with falling pressure towards the pump or a leak", () => {
    const flow = series("w", "EAU", "C01", (t) => (t > T0 + 3 * 24 * HOUR ? usual(t) * 0.5 : usual(t)), { unit: "L" });
    const pressure = series("p", "PRESSION_EAU", "C03", (t) => (t > T0 + 3 * 24 * HOUR ? 1.2 : 2), { unit: "BAR" });
    const v = evaluator("EAU_PROFIL").evaluate(ctxAt(T0 + 3 * 24 * HOUR + 8 * HOUR, [flow, pressure]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("pompe");
    expect(v.diagnosis).toContain("pas de diagnostic automatique");
  });

  it("orients a drop with normal pressure towards access to water", () => {
    const flow = series("w", "EAU", "C01", (t) => (t > T0 + 3 * 24 * HOUR ? usual(t) * 0.5 : usual(t)), { unit: "L" });
    const pressure = series("p", "PRESSION_EAU", "C03", () => 2, { unit: "BAR" });
    expect(evaluator("EAU_PROFIL").evaluate(ctxAt(T0 + 3 * 24 * HOUR + 8 * HOUR, [flow, pressure]))[0].diagnosis).toContain("accès à l'eau");
  });

  it("does not read a gateway outage as a drop", () => {
    const flow = series("w", "EAU", "C01", (t) => (t > T0 + 3 * 24 * HOUR ? null : usual(t)), { unit: "L" });
    expect(evaluator("EAU_PROFIL").evaluate(ctxAt(T0 + 3 * 24 * HOUR + 8 * HOUR, [flow]))).toEqual([]);
  });

  it("flags one line drinking less at constant total", () => {
    const l1 = series("l1", "DEBIT_EAU", "C02", () => 10, { position: "Ligne 1", unit: "L/MIN" });
    const l2 = series("l2", "DEBIT_EAU", "C02", () => 4, { position: "Ligne 2", unit: "L/MIN" });
    const v = evaluator("EAU_DESEQUILIBRE_LIGNES").evaluate(ctxAt(T0 + 5 * HOUR, [l1, l2]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("Ligne 2");
  });

  it("states the tank autonomy in hours", () => {
    const tank = series("k", "NIVEAU_CUVE", "C04", (t) => 2000 - ((t - T0) / HOUR) * 100, { every: 5 * MIN, to: T0 + 18 * HOUR, zoneKind: "SITE", unit: "L" });
    const v = evaluator("CUVE_AUTONOMIE").evaluate(ctxAt(T0 + 17 * HOUR, [tank]))[0];
    expect(v.state).toBe("CRITIQUE");
    expect(v.value).toBeCloseTo(3, 0);
  });
});

describe("feed (D01, D04)", () => {
  it("detects a delivery by mass jump through the wind filter, once", () => {
    const silo = series(
      "s",
      "MASSE_SILO",
      "D01",
      (t) => {
        const base = t < T0 + 10 * HOUR ? 3000 - ((t - T0) / HOUR) * 50 : 8000 - ((t - T0 - 10 * HOUR) / HOUR) * 50;
        const gust = (t / (5 * MIN)) % 7 === 3 ? 400 : 0; // a single wind spike
        return base + gust;
      },
      { every: 5 * MIN, unit: "KG" }
    );
    const v = evaluator("SILO_STOCK").evaluate(ctxAt(T0 + 20 * HOUR, [silo]))[0];
    expect(v.derivedEvents).toHaveLength(1);
    expect(v.derivedEvents![0].payload.deliveredKg).toBeGreaterThan(4000);
    const again = evaluator("SILO_STOCK").evaluate(ctxAt(T0 + 20 * HOUR + 5 * MIN, [silo], { memory: () => v.memory! }))[0];
    expect(again.derivedEvents).toHaveLength(0);
  });

  it("fires when the motor is commanded and the screw does not turn", () => {
    const cmd = series("cmd", "COMMANDE_VIS", "PLC", () => 1, { every: MIN, unit: "ETAT", position: "Ligne 1" });
    const rot = series("rot", "ROTATION_VIS", "D04", (t) => (t > T0 + HOUR ? 0 : 40), { every: MIN, unit: "TR/MIN", position: "Ligne 1" });
    expect(evaluator("VIS_SANS_ROTATION").evaluate(ctxAt(T0 + HOUR + 2 * MIN, [cmd, rot]))[0].state).toBe("NORMAL");
    expect(evaluator("VIS_SANS_ROTATION").evaluate(ctxAt(T0 + HOUR + 4 * MIN, [cmd, rot]))[0].state).toBe("CRITIQUE");
  });
});

describe("weighing (E01, E02)", () => {
  it("computes uniformity and mode", () => {
    const s = weighingStats([1.0, 1.02, 0.98, 1.05, 1.5, 0.6]);
    expect(s?.n).toBe(6);
    expect(s?.homogeneityPct).toBeCloseTo((4 / 6) * 100);
  });

  it("flags a heterogeneous flock", () => {
    let i = 0;
    const scale = series("e", "POIDS", "E01", () => (i++ % 2 ? 1.6 : 0.9), { every: 5 * MIN, unit: "KG" });
    const v = evaluator("PESEE_HOMOGENEITE").evaluate(ctxAt(T0 + 24 * HOUR, [scale]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("homogénéité");
  });
});

describe("hatchery (H06) and egg room (H06b)", () => {
  it("flags the gap between the independent probes and the machine", () => {
    const probes = ["HAUT", "MILIEU", "BAS"].map((pos) => series(`h-${pos}`, "TEMPERATURE", "H06", () => 37.5, { zoneId: "inc1", zoneKind: "INCUBATEUR", position: pos, every: MIN }));
    const machine = series("m", "TEMPERATURE_MACHINE", "PLC", () => 37.6 + 0.8, { zoneId: "inc1", zoneKind: "INCUBATEUR", every: MIN });
    const v = evaluator("COUVOIR_POSITIONS").evaluate(ctxAt(T0 + HOUR, [...probes, machine]))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("sonde qui dérive");
  });

  it("flags a door left open in the egg room by the gap between its two points", () => {
    const door = series("d", "TEMPERATURE", "H06b", () => 20.5, { zoneId: "eggs", zoneKind: "SALLE_OEUFS", position: "PORTE", every: 5 * MIN });
    const far = series("f", "TEMPERATURE", "H06b", () => 16, { zoneId: "eggs", zoneKind: "SALLE_OEUFS", position: "FOND", every: 5 * MIN });
    expect(evaluator("SALLE_OEUFS_ECART").evaluate(ctxAt(T0 + HOUR, [door, far]))[0].diagnosis).toContain("porte restée ouverte");
  });
});

describe("access (O01)", () => {
  const ev = (kind: SiteEventPoint["kind"], at: number, badge: string | null = null): SiteEventPoint => ({ deviceId: "door", deviceCode: "PORTE-B1", kind, at, badge });
  it("catches an opening at night even if the door was shut before the next look", () => {
    const night = Date.parse("2026-08-10T01:30:00Z"); // 02:30 local
    const events = [ev("ACCES_BADGE", night, "B-117"), ev("PORTE_OUVERTE", night + 10_000), ev("PORTE_FERMEE", night + 60_000)];
    const v = evaluator("ACCES_HORS_PLAGE").evaluate(ctxAt(night + 2 * MIN, [], { events }))[0];
    expect(v.state).toBe("ALERTE");
    expect(v.diagnosis).toContain("B-117");
  });

  it("flags a door left open during the day", () => {
    const day = Date.parse("2026-08-10T09:00:00Z");
    const v = evaluator("ACCES_HORS_PLAGE").evaluate(ctxAt(day + 20 * MIN, [], { events: [ev("PORTE_OUVERTE", day)] }))[0];
    expect(v.diagnosis).toContain("ouverte depuis 20 min");
  });
});

describe("silence", () => {
  const now = Date.parse("2026-08-16T12:00:00Z");
  const sensor = (id: string, lastMinutesAgo: number | null, gatewayId = "gw1") => ({
    sensorId: id,
    label: id,
    gatewayId,
    gatewayLabel: "GW-B1",
    buildingId: "b1",
    reportSeconds: 120,
    lastReadingAt: lastMinutesAgo === null ? null : now - lastMinutesAgo * MIN,
    installedAt: now - 30 * 24 * HOUR,
  });

  it("raises one gateway verdict, not one per channel, when the whole gateway is silent", () => {
    const out = silenceVerdicts([sensor("a", 90), sensor("b", 95)], now, defaultParams("CAPTEUR_SILENCIEUX"));
    expect(out).toHaveLength(1);
    expect(out[0].subjectKey).toBe("gateway:gw1");
    expect(out[0].state).toBe("CRITIQUE");
  });

  it("names the one silent sensor when the gateway still talks", () => {
    const out = silenceVerdicts([sensor("a", 2), sensor("b", 30)], now, defaultParams("CAPTEUR_SILENCIEUX"));
    expect(out.find((v) => v.subjectKey === "sensor:b")?.state).toBe("ALERTE");
    expect(out.find((v) => v.subjectKey === "gateway:gw1")?.state).toBe("NORMAL");
  });
});

describe("runner", () => {
  const fixture = () => {
    const temp = series("t1", "TEMPERATURE", "A01", (t) => (t >= T0 + 26 * HOUR && t < T0 + 28 * HOUR ? 31 : 24));
    const nh3 = series("n1", "NH3", "A03", (t) => (t >= T0 + 40 * HOUR && t < T0 + 44 * HOUR ? 28 : 8), { unit: "PPM" });
    return [temp, nh3];
  };
  const base = (states: Map<string, SubjectState>, from: number, to: number) =>
    runRules({
      buildingId: "b1",
      buildingName: "B1",
      from,
      to,
      series: fixture(),
      events: [],
      bands: [tempBand],
      occupantOf: () => lot,
      params: (rule) => mergeParams(rule),
      states,
    });

  it("writes only changes of state", () => {
    const out = base(new Map(), T0, T0 + 3 * 24 * HOUR);
    const temp = out.transitions.filter((t) => t.rule === "BANDE_APPRISE");
    expect(temp.map((t) => `${t.from}>${t.to}`)).toEqual(["NORMAL>ALERTE", "ALERTE>NORMAL"]);
    expect(out.steps).toBe((3 * 24 * HOUR) / (2 * MIN));
  });

  it("gives the same transitions, at the same instants, live or replayed after a 3-day outage", () => {
    const replayed = base(new Map(), T0, T0 + 3 * 24 * HOUR).transitions.map((t) => `${t.rule}@${t.at}:${t.to}`);
    const states = new Map<string, SubjectState>();
    const live: string[] = [];
    for (let to = T0 + 2 * MIN; to <= T0 + 3 * 24 * HOUR; to += 2 * MIN) {
      live.push(...base(states, to - 2 * MIN, to).transitions.map((t) => `${t.rule}@${t.at}:${t.to}`));
    }
    expect(live).toEqual(replayed);
    expect(replayed.length).toBeGreaterThan(2);
  });

  it("starts from the stored state, so a resumed run does not repeat a transition", () => {
    const states = new Map<string, SubjectState>([[stateKey("BANDE_APPRISE", "t1"), { state: "ALERTE", since: T0, memory: null }]]);
    const out = base(states, T0 + 27 * HOUR, T0 + 27 * HOUR + 10 * MIN);
    expect(out.transitions.filter((t) => t.rule === "BANDE_APPRISE")).toEqual([]);
  });
});
